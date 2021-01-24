import http2            from 'http2';
import { EventEmitter } from 'events';
import { uuidv4 }       from './utils';

export type StreamListener = (stream: http2.Http2Stream, headers: http2.IncomingHttpHeaders) => void;
export type SessionListener = (stream: http2.Http2Session, headers: http2.IncomingHttpHeaders) => void;

type Abstract<T> = Function & { prototype: T };
type Constructor<T> = new (...args: any[]) => void;
type Class<T> = Abstract<T> | Constructor<T>;

type CachedListener = { _class: Class<any>, methodName: string }

/**
 * creates and manages our collection of servers
 */
class _Http2Factory extends EventEmitter {
  private servers: { [key: string]: Http2Server } = {};

  constructor() {
    super();
    this.InitFactoryListeners();
  }

  /**
   * this is how we make new Http2Servers
   */
  public Create(name: string, key?: Buffer, cert?: Buffer): Http2Server {
    const newServer = new Http2Server(name, key, cert);
    this.AddServer(name, newServer);
    return newServer;
  }

  public GetServer(name: string): Http2Server {
    if (!this.servers[name]) {
      throw new Error('no http2 server found with that name');
    }
    return this.servers[name];
  }

  private AddServer(name: string, server: Http2Server): boolean {
    if (this.servers[name]) {
      throw new Error('an http2 server with that name already exists');
      return false;
    }
    this.servers[name] = server;
    return true;
  }

  private RemoveServer(name): boolean {
    delete this.servers[name];
    return true;
  }

  /**
   * emits an event to each associated server disconnecting them all
   */
  public async DisconnectAll(): Promise<void> {
    await this.disconnect();
  }

  @FactoryBroadcast()
  private async disconnect(): Promise<void> {
  }

  /**
   * send a message to each associated server - e.g. system wide broadcast
   */
  public async WriteAll(...args): Promise<void> {
    await this.writeAll(...args);
  }

  @FactoryBroadcast()
  private async writeAll(...args): Promise<void> {
  }

  private InitFactoryListeners(): void {
    this.on('server:close', (serverName: string) => {
      this.RemoveServer(serverName);
    });
  }
}

/**
 * export as a singleton
 */
export const Http2Factory = new _Http2Factory();

/**
 * an individual server
 */
class Http2Server {
  protected server: http2.Http2Server;
  protected streamCache = {};
  protected streamListeners: CachedListener[] = [];
  protected sessionListeners: CachedListener[] = [];
  readonly name: string;

  constructor(name: string, key?: Buffer, cert?: Buffer) {
    this.name = name;

    if (key && cert) {
      this.server = http2.createSecureServer({ key, cert });
    }
    else {
      this.server = http2.createServer();
    }

    /**
     * we allow the factory to have a line of communication directly to all servers
     */
    Http2Factory.on('broadcast', (methodName: string, ...args) => {
      Reflect.get(this, methodName).apply(this, args);
    });
  }

  public addStreamListener(_class: Class<any>, methodName: string): void {
    this.streamListeners.push({ _class, methodName });
  }

  public addSessionListener(_class: Class<any>, methodName: string): void {
    this.sessionListeners.push({ _class, methodName });
  }

  private async digest(listeners: CachedListener[], ...args): Promise<void> {
    for (const listener of listeners) {
      const targetClass = new (Reflect.get(listener._class, 'constructor'));

      if (targetClass[listener.methodName][Symbol.toStringTag] === 'AsyncFunction') {
        await targetClass[listener.methodName](...args);
      }
      else {
        targetClass[listener.methodName](...args);
      }
    }
  }

  /**
   * send a message over all active connections for this server e.g. server wide broadcast
   */
  public writeAll(...args): void {
    for (const stream in this.streamCache) {
      this.streamCache[stream].write(...args);
    }
  }

  /**
   * if we need to emit directly over the server
   */
  public emit(event: string, ...args): void {
    this.server.emit(event, ...args);
  }

  /**
   * if we need to listen directly over the server
   */
  public on(event: string, listener: StreamListener): void {
    this.server.on(event, listener);
  }

  public listen(port: number): void {
    this.initListeners();
    this.server.listen(port);
  }

  public disconnect(): void {
    this.streamCache = {};
    this.server.close();
    Http2Factory.emit('server:close', this.name);
  }

  private removeFromCache(streamId: string): boolean {
    if (this.streamCache[streamId]) {
      delete this.streamCache[streamId];
      return true;
    }
    return false;
  }

  /**
   * prepares the initial OK response when someone connects and then emits internally. This prevents a free for all
   * for the server listener
   */
  private initListeners(): void {
    this.server.on('stream', async (stream: http2.ServerHttp2Stream, headers: http2.IncomingHttpHeaders) => {
      /**
       * we maintain a cache of stream references for later use
       */
      const id = uuidv4();
      Reflect.set(stream, 'streamId', id);
      this.streamCache[id] = stream;

      stream.on('close', () => {
        this.removeFromCache(id);
      });

      await this.digest(this.streamListeners, stream, headers);
    });

    /**
     * we also make the session available to the application interior once it is ready. We can use this for things
     * such as seeing where the connection came from
     */
    this.server.on('session', async (session: http2.ServerHttp2Session) => {
      await this.digest(this.sessionListeners, session);
    });
  }
}

/**
 * Decorators!
 */

/**
 * create a stream listener for a given http2 server
 */
export function Http2Listener(serverName: string) {
  return function Http2Listener(target, propertyKey) {
    const server = Http2Factory.GetServer(serverName);
    server.addStreamListener(target, propertyKey);
  };
}

/**
 * create a session listener for a given http2 server
 */
export function Http2SessionListener(serverName: string) {
  return function Http2SessionListenerInner(target, propertyKey) {
    const server = Http2Factory.GetServer(serverName);
    server.addSessionListener(target, propertyKey);
  };
}

/**
 * a stream listener except this time it continues running on a set interval as long as the connection lives
 */
export function Http2Poll(serverName: string, pollingTime: number) {
  return function PollInner(target, propertyKey: string, descriptor) {
    const server = Http2Factory.GetServer(serverName);
    server.addStreamListener(target, propertyKey);

    const { value } = descriptor;
    descriptor.value = function (stream: http2.Http2Stream, headers: http2.IncomingHttpHeaders) {
      value(stream, headers);

      const interval = setInterval(() => {
        if (stream.closed) {
          clearInterval(interval);
        }
        value(stream, headers);
      }, pollingTime);
    };
  };
}

/**
 * broadcast the output of decorated method to all connections on the specified server
 */
export function ServerBroadcast(serverName: string) {
  return function ServerBroadcastInner(target, propertyKey: string, descriptor) {
    const { value } = descriptor;

    descriptor.value = function (...args) {
      if (value[Symbol.toStringTag] === 'AsyncFunction') {
        value(...args).then((res) => {
          const server = Http2Factory.GetServer(serverName);
          server.writeAll(res);
        });
      }
      else {
        const server = Http2Factory.GetServer(serverName);
        server.writeAll(value(...args));
      }
    };
  };
}

/**
 * broadcast a method to all servers from Http2Factory
 */
export function FactoryBroadcast() {
  return function BroadcastInner(target, propertyKey: string, descriptor) {
    const { value } = descriptor;
    descriptor.value = function () {
      value();
      this.emitter.emit('broadcast', propertyKey, ...Object.values(arguments));
    };
  };
}
