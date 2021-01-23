import http2            from 'http2';
import { EventEmitter } from 'events';
import { uuidv4 }       from './utils';

type StreamListener = (stream: http2.Http2Stream, headers: http2.IncomingHttpHeaders) => void;

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
  public Create(name: string, key?: Buffer, cert?: Buffer) {
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

  private AddServer(name: string, server: Http2Server): void {
    if (this.servers[name]) {
      throw new Error('an http2 server with that name already exists');
    }
    this.servers[name] = server;
  }

  private RemoveServer(name) {
    delete this.servers[name];
  }

  /**
   * emits an event to each associated server disconnecting them all
   */
  public async DisconnectAll() {
    await this.disconnect();
  }

  @FactoryBroadcast()
  private async disconnect(): Promise<void> {
  }

  /**
   * send a message to each associated server - e.g. system wide broadcast
   */
  public async WriteAll(...args) {
    await this.writeAll(...args);
  }

  @FactoryBroadcast()
  private async writeAll(...args) {
  }

  private InitFactoryListeners() {
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
  protected streamListeners: any = [];
  protected sessionListeners: any = [];
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

  public addStreamListener(protoClass: { any }, methodName: string) {
    this.streamListeners.push({ protoClass, methodName });
  }

  public addSessionListener(protoClass: { any }, methodName: string) {
    this.sessionListeners.push({ protoClass, methodName });
  }

  private async digest(listeners: { protoClass: any, methodName: string }[], ...args) {
    for (const listener of listeners) {
      const targetClass = new listener.protoClass.constructor();

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
  public writeAll(...args) {
    for (const stream in this.streamCache) {
      this.streamCache[stream].write(...args);
    }
  }

  /**
   * if we need to emit directly over the server
   */
  public emit(event: string, ...args) {
    this.server.emit(event, ...args);
  }

  /**
   * if we need to listen directly over the server
   */
  public on(event: string, listener: StreamListener) {
    this.server.on(event, listener);
  }

  public listen(port: number) {
    this.initListeners();
    this.server.listen(port);
  }

  public disconnect() {
    this.streamCache = {};
    this.server.close();
    Http2Factory.emit('server:close', this.name);
  }

  private removeFromCache(streamId: string) {
    if (this.streamCache[streamId]) {
      delete this.streamCache[streamId];
    }
  }

  /**
   * prepares the initial OK response when someone connects and then emits internally. This prevents a free for all
   * for the server listener
   */
  private initListeners() {
    this.server.on('stream', (stream: http2.ServerHttp2Stream, headers: http2.IncomingHttpHeaders) => {
      /**
       * we maintain a cache of stream references for later use
       */
      const id = uuidv4();
      Reflect.set(stream, 'streamId', id);
      this.streamCache[id] = stream;

      stream.on('close', () => {
        this.removeFromCache(id);
      });

      this.digest(this.streamListeners, stream, headers).catch(console.error);
    });

    /**
     * we also make the session available to the application interior once it is ready. We can use this for things
     * such as seeing where the connection came from
     */
    this.server.on('session', (session: http2.ServerHttp2Session) => {
      this.digest(this.sessionListeners, session).catch(console.error);
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
