/**
 * 1v1 on the page: the room's connection (socket.ts), what the room has said
 * (room.ts) and the game on screen (controller.ts), kept in step.
 *
 * In every other mode the game asks and the server answers. Here the room
 * speaks first: it sends the question to both players at the same moment, and
 * the reveal when both have answered or its deadline has passed. So this turns
 * the room's messages into what the controller already understands:
 *
 * - a match's first `question` starts a run, and the API's `start` hands the
 *   controller that question;
 * - a pick the controller locks in goes to the room at once (`lock`);
 * - a `reveal` is kept, the controller is told (`revealed`), and the API's
 *   `answer` hands it over, with the next question or the end, exactly the
 *   shape the other modes' answers have;
 * - coming back to a match (a refresh, a new tab, a dropped connection), the
 *   room's `welcome` says where it is, and the game picks it up there
 *   (`resume`), its clock still running.
 *
 * The room is always right. Whenever the game on screen isn't where the room
 * says the match is (a page that slept through a question), it is moved there
 * rather than left to play out something stale.
 *
 * Framework-free, with the socket, the seat store and the clock injected, so
 * the whole flow runs under test in Node against a fake socket.
 */

import type {
  RoomClosedReason,
  RoomErrorCode,
  RoomQuestion,
  RoomServerMessage,
  RoundPayload,
  RunEnd,
  StartResponse,
  TimedGuess,
} from "@bt/core";
import { ApiFailure } from "../api";
import type { GameApi } from "../api";
import type { Answered, GameState, Phase, StreamSettings } from "../machine";
import { reduceRoom, withPick } from "./room";
import type { DuelView } from "./room";
import type { SeatStore } from "./session";
import type { LinkStatus, RoomSocket } from "./socket";

/** The part of the game controller this drives (controller.ts). */
export interface DuelGame {
  readonly state: GameState;
  start(): void;
  revealed(): void;
  stop(end: RunEnd): void;
  resume(run: {
    readonly runId: string;
    readonly round: RoundPayload;
    readonly results: readonly boolean[];
    readonly remainingMs: number | null;
    readonly stream?: StreamSettings;
    readonly locked?: TimedGuess;
  }): void;
}

/** Everything the page draws a room from. */
export interface DuelSnapshot {
  /** The room this page is in, or trying to be; null on the setup screen. */
  readonly code: string | null;
  /** What the room has said; null until its first `welcome`. */
  readonly view: DuelView | null;
  readonly link: LinkStatus;
  /** Why the room closed for this player; null while it hasn't. */
  readonly closed: RoomClosedReason | null;
  /** The room's last refusal (Start before everyone is ready…), until the next thing goes through. */
  readonly refused: RoomErrorCode | null;
}

export interface DuelClientDeps {
  readonly socket: Pick<
    RoomSocket,
    "connect" | "send" | "leave" | "destroy" | "onMessage" | "onStatus" | "status"
  >;
  readonly seats: SeatStore;
  /** The game's own clock: `performance.now()`. */
  readonly now: () => number;
  readonly onChange: (snapshot: DuelSnapshot) => void;
}

/** Phases in which a question is on its way or waiting: before its reveal has been played. */
const BEFORE_REVEAL: readonly Phase[] = ["dealing", "spinning", "awaiting"];
/** The same, with a run's opening: round one behind its title card. */
const OPENING: readonly Phase[] = ["starting", "title", "holding", "intro", ...BEFORE_REVEAL];

function running(state: GameState): boolean {
  return state.phase !== "idle" && state.phase !== "over";
}

export class DuelClient {
  readonly #deps: DuelClientDeps;
  #game: DuelGame | null = null;
  #code: string | null = null;
  #view: DuelView | null = null;
  #closed: RoomClosedReason | null = null;
  #refused: RoomErrorCode | null = null;
  /** A match's first question, until the controller's start takes it. */
  #opening: { readonly question: RoomQuestion; readonly at: number } | null = null;
  /** Reveals the room has sent, by run and question, until the controller's answer takes them. */
  readonly #reveals = new Map<string, Answered>();
  readonly #waiting = new Map<string, (response: Answered) => void>();
  readonly #unsubscribe: (() => void)[];

  constructor(deps: DuelClientDeps) {
    this.#deps = deps;
    this.#unsubscribe = [
      deps.socket.onMessage((message) => this.#onMessage(message)),
      deps.socket.onStatus((status) => this.#onStatus(status)),
    ];
  }

  /** The game this room drives. */
  attach(game: DuelGame): void {
    this.#game = game;
  }

  get snapshot(): DuelSnapshot {
    return {
      code: this.#code,
      view: this.#view,
      link: this.#deps.socket.status,
      closed: this.#closed,
      refused: this.#refused,
    };
  }

  /**
   * The controller's API in 1v1: it never asks the server anything. `start`
   * and `answer` hand over what the room has already sent.
   */
  get api(): GameApi {
    return {
      start: async (): Promise<StartResponse> => {
        const opening = this.#opening;
        const view = this.#view;
        if (opening === null || view === null) throw new ApiFailure(0, "network");
        this.#opening = null;
        const { question, at } = opening;
        const started: StartResponse & StreamSettings & { capAt: number } = {
          runId: this.#runId(question.match),
          round: question.round,
          pool: view.settings.pool,
          questions: view.settings.questions,
          limit: view.settings.limit,
          capAt: at + question.closesInMs,
        };
        return started;
      },
      answer: (runId, round): Promise<Answered> => {
        const key = `${runId}#${round}`;
        const kept = this.#reveals.get(key);
        if (kept !== undefined) {
          this.#reveals.delete(key);
          return Promise.resolve(kept);
        }
        // Asked before the room has revealed it: answered when it does.
        return new Promise((resolve) => this.#waiting.set(key, resolve));
      },
    };
  }

  /** Takes this seat in the room: remembers the token on this device, and connects. */
  enter(code: string, token: string): void {
    this.#reset();
    this.#code = code;
    this.#deps.seats.save(code, token);
    this.#deps.socket.connect(code, token);
    this.#emit();
  }

  ready(ready: boolean): void {
    this.#say({ v: 1, t: "ready", ready });
  }

  /** The host's Start. */
  startMatch(): void {
    this.#say({ v: 1, t: "start" });
  }

  rematch(): void {
    this.#say({ v: 1, t: "rematch" });
  }

  /** The controller locked in a pick (or the clock ran out): it goes to the room at once. */
  lock(round: number, pick: TimedGuess): void {
    if (this.#view !== null) this.#view = withPick(this.#view, pick);
    this.#deps.socket.send({ v: 1, t: "answer", q: round, pick });
    this.#emit();
  }

  /** Leaves the room for good: the seat is given up, and nothing of it is kept here. */
  leave(): void {
    const code = this.#code;
    this.#deps.socket.leave();
    if (code !== null) this.#deps.seats.clear(code);
    this.#stopGame();
    this.#reset();
    this.#emit();
  }

  /** Back to the setup screen from a room that has closed. */
  forget(): void {
    this.#reset();
    this.#emit();
  }

  destroy(): void {
    for (const off of this.#unsubscribe) off();
    this.#deps.socket.destroy();
  }

  #runId(match: number): string {
    return `duel:${this.#code ?? ""}:${match}`;
  }

  #reset(): void {
    this.#code = null;
    this.#view = null;
    this.#closed = null;
    this.#refused = null;
    this.#opening = null;
    this.#reveals.clear();
    this.#waiting.clear();
  }

  #emit(): void {
    this.#deps.onChange(this.snapshot);
  }

  #say(message: Parameters<RoomSocket["send"]>[0]): void {
    this.#refused = null;
    this.#deps.socket.send(message);
    this.#emit();
  }

  #stopGame(): void {
    const game = this.#game;
    if (game !== null && running(game.state)) game.stop("finished");
  }

  #onStatus(status: LinkStatus): void {
    // Hung up on with no goodbye to read: the room has nothing for this seat.
    if (status.kind === "closed" && this.#code !== null && this.#closed === null) {
      this.#shut("unknown");
    }
    this.#emit();
  }

  /** The room is closed for this player. Their seat goes with it, unless another tab of theirs has it. */
  #shut(reason: RoomClosedReason): void {
    this.#closed = reason;
    if (reason !== "replaced" && this.#code !== null) this.#deps.seats.clear(this.#code);
    this.#stopGame();
  }

  #onMessage(message: RoomServerMessage): void {
    const at = this.#deps.now();
    if (message.t === "closed") {
      this.#shut(message.reason);
      this.#emit();
      return;
    }
    if (message.t === "error") {
      // A token the room won't have: nothing to come back to with it.
      if (message.code === "bad_token") this.#shut("unknown");
      else this.#refused = message.code;
      this.#emit();
      return;
    }
    this.#view = reduceRoom(this.#view, message, at);
    switch (message.t) {
      case "welcome":
        this.#closed = null;
        this.#refused = null;
        this.#sync(at);
        break;
      case "question": {
        this.#refused = null;
        this.#reveals.clear();
        this.#opening = { question: message.question, at };
        const game = this.#game;
        if (game !== null) {
          if (running(game.state)) game.stop("finished");
          game.start();
        }
        break;
      }
      case "reveal":
        this.#onReveal(message, at);
        break;
      case "fulltime":
        // A forfeit: there is no reveal to play.
        this.#stopGame();
        break;
      default:
        break;
    }
    this.#emit();
  }

  #onReveal(message: Extract<RoomServerMessage, { t: "reveal" }>, at: number): void {
    const view = this.#view;
    const game = this.#game;
    if (view === null) return;
    const index = message.reveal.round;
    const runId = this.#runId(view.matchNo);
    const response: Answered =
      message.next !== undefined && message.end === undefined
        ? {
            reveal: message.reveal,
            next: message.next.round,
            capAt: at + message.next.closesInMs,
          }
        : { reveal: message.reveal, end: "finished" };
    const key = `${runId}#${index}`;
    const waiting = this.#waiting.get(key);
    if (waiting !== undefined) {
      this.#waiting.delete(key);
      waiting(response);
      return;
    }
    if (game === null) return;
    const { state } = game;
    const inStep =
      state.runId === runId && state.round?.index === index && BEFORE_REVEAL.includes(state.phase);
    if (inStep) {
      this.#reveals.set(key, response);
      game.revealed();
      return;
    }
    // The game isn't on this question (a page that slept): go to where the room is.
    this.#sync(at);
  }

  /** Puts the game where the room says the match is. */
  #sync(at: number): void {
    const game = this.#game;
    const view = this.#view;
    if (game === null || view === null) return;
    const { question } = view;
    if (view.phase !== "playing" || question === null) {
      // No question open: a lobby, or full time. A last reveal still playing plays out.
      const state = game.state;
      const finishing =
        view.phase === "fulltime" &&
        (state.phase === "revealing" || state.phase === "verdict" || state.phase === "sliding");
      if (!finishing) this.#stopGame();
      return;
    }
    const runId = this.#runId(view.matchNo);
    const { state } = game;
    const inStep =
      state.runId === runId &&
      state.round?.index === question.round.index &&
      OPENING.includes(state.phase);
    if (inStep) {
      // Back on the same question. A pick the room never got goes again.
      if (state.locked !== null && view.picked === null) this.#lockAgain(question, state.locked);
      return;
    }
    this.#stopGame();
    this.#reveals.clear();
    this.#opening = null;
    game.resume({
      runId,
      round: question.round,
      results: view.results[view.you] ?? [],
      remainingMs: Math.max(0, (view.closesAt ?? at) - at),
      stream: {
        pool: view.settings.pool,
        questions: view.settings.questions,
        limit: view.settings.limit,
      },
      ...(view.picked !== null ? { locked: view.picked } : {}),
    });
  }

  /** Sends a pick again after a reconnect, when the room's snapshot doesn't have it. */
  #lockAgain(question: RoomQuestion, pick: TimedGuess): void {
    if (this.#view !== null) this.#view = withPick(this.#view, pick);
    this.#deps.socket.send({ v: 1, t: "answer", q: question.round.index, pick });
  }
}
