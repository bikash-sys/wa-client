import { EventEmitter } from "node:events";

/**
 * Type-safe event emitter implementation wrapping Node.js EventEmitter.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class TypedEventEmitter<TEvents extends { [K in keyof TEvents]: (...args: any[]) => void }> {
  private readonly _emitter = new EventEmitter();

  public on<E extends keyof TEvents & string>(event: E, listener: TEvents[E]): this {
    this._emitter.on(event, listener as (...args: unknown[]) => void);
    return this;
  }

  public once<E extends keyof TEvents & string>(event: E, listener: TEvents[E]): this {
    this._emitter.once(event, listener as (...args: unknown[]) => void);
    return this;
  }

  public off<E extends keyof TEvents & string>(event: E, listener: TEvents[E]): this {
    this._emitter.off(event, listener as (...args: unknown[]) => void);
    return this;
  }

  public emit<E extends keyof TEvents & string>(
    event: E,
    ...args: Parameters<TEvents[E]>
  ): boolean {
    return this._emitter.emit(event, ...args);
  }

  public addListener<E extends keyof TEvents & string>(event: E, listener: TEvents[E]): this {
    return this.on(event, listener);
  }

  public removeListener<E extends keyof TEvents & string>(event: E, listener: TEvents[E]): this {
    return this.off(event, listener);
  }

  public removeAllListeners(event?: (keyof TEvents & string) | undefined): this {
    this._emitter.removeAllListeners(event);
    return this;
  }

  public listenerCount(event: keyof TEvents & string): number {
    return this._emitter.listenerCount(event);
  }
}
