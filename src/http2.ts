import http2            from 'http2';
import { EventEmitter } from 'events';
import { v4 as uuid }   from 'uuid';

type StreamListener = (stream: http2.Http2Stream, headers: http2.ClientSessionRequestOptions) => void;

/**
 * creates and manages our collection of servers
 */

class Http2FactorySingleton {
  emitter = new EventEmitter();
  _servers: { [key: string]: Http2Server } = {};

  // FaCtOrY PaTtErN
  public Create(name: string, key?: string, cert?: string) {
    const newServer = new Http2Server(name, this.emitter, key, cert);
    this.AddServer(name, newServer);
    return newServer;
  }

  public GetServer(serverName: string): Http2Server {
    if (!this._servers[serverName]) {
      throw new Error('no http2 server found with that name');
    }
    return this._servers[serverName];
  }

  private AddServer(name: string, server: Http2Server): void {
    if (this._servers[name]) {
      throw new Error('an http2 server with that name already exists');
    }
    this._servers[name] = server;
  }

  /**
   * disconnect ALL servers
   */
  @Broadcast()
  async disconnect(): Promise<void> {
  }

  /**
   * send a message to ALL servers e.g. system wide broadcast
   *
   * @param args
   */
  @Broadcast()
  async writeAll(...args) {
  }
}

/**
 * an individual server
 */
class Http2Server {
  private readonly _name: string;
  public emitter = new EventEmitter();
  protected _server: http2.Http2Server;
  protected _streamCache = {};

  constructor(name: string, factoryEmitter: EventEmitter, key?: string, cert?: string) {
    this._name = name;
    this._server = http2.createServer();

    /**
     * we allow the factory to have a line of communication directly to all servers
     */
    factoryEmitter.on('broadcast', (methodName: string, ...args) => {
      Reflect.get(this, methodName).apply(this, args);
    });
  }

  get name(): string {
    return this._name;
  }

  /**
   * send a message over all active connections for this server e.g. server wide broadcast
   */
  public writeAll(...args) {
    for (const stream in this._streamCache) {
      this._streamCache[stream].write(...args);
    }
  }

  /**
   * if we need to emit directly over the server
   *
   * @param event
   * @param args
   */
  public emit(event: string, ...args) {
    this._server.emit(event, ...args);
  }

  /**
   * if we need to listen directly over the server
   *
   * @param event
   * @param listener
   */
  public on(event: string, listener: StreamListener) {
    this._server.on(event, listener);
  }

  public connect(port: number) {
    this.initStreamEmitter();
    this._server.listen(port);
  }

  public disconnect() {
    this._server.close();
  }

  private removeFromCache(streamId: number) {
    if (this._streamCache[streamId]) {
      delete this._streamCache[streamId];
    }
  }

  /**
   * prepares the initial OK response when someone connects and then emits internally. This prevents a free for all
   * for the server listener
   *
   * @private
   */
  private initStreamEmitter() {
    this._server.on('stream', (stream, headers) => {
      /**
       * we have a separate emitter for events inside our application. There has to be an order of operations:
       * 1) we receive the incoming stream
       * 2) we respond OK
       * 3) we feed the stream to application internal emitters for them to do with what they like
       *
       * we also want to expose the server itself through an interface. You can then directly use the server emitter if
       * needed.
       */

      /**
       * we maintain a cache of stream references for later use
       */
      const id = uuid();
      Reflect.set(stream, 'streamId', id);
      this._streamCache[id] = stream;

      stream.on('close', () => {
        this.removeFromCache(id);
      });

      stream.respond({ ':status': 200, 'content-type': 'text/plain' });
      this.emitter.emit(`${this.name}:Http2Stream`, stream, headers);
    });

    /**
     * we also make the session available to the application interior once it is ready. We can use this for things
     * such as seeing where the connection came from
     */
    this._server.on('session', (session) => {
      this.emitter.emit(`${this.name}:Http2Session`, session);
    });
  }
}

/**
 * export as a singleton
 */
export const Http2Factory = new Http2FactorySingleton();

/**
 * Decorators!
 */

/**
 * create a stream listener for a given http2 server
 *
 * @constructor
 * @param serverName
 */
export function Http2Listener(serverName: string) {
  return function Http2Listener(target, propertyKey, descriptor) {
    const server = Http2Factory.GetServer(serverName);
    server.emitter.on(`${serverName}:Http2Stream`, function (stream: http2.Http2Stream, headers: http2.ClientSessionRequestOptions) {
      descriptor.value(stream, headers);
    });
  };
}

/**
 * create a session listener for a given http2 server
 *
 * @param serverName
 * @constructor
 */
export function Http2SessionListener(serverName: string) {
  return function Http2SessionListenerInner(target, propertyKey, descriptor) {
    const server = Http2Factory.GetServer(serverName);
    server.emitter.on(`${serverName}:Http2Session`, function (session: http2.Http2Session) {
      descriptor.value(session);
    });
  };
}

/**
 * broadcast the output of decorated method to all connections on the specified server
 *
 * @param serverName
 * @constructor
 */
export function ServerBroadcast(serverName: string) {
  return function ServerBroadcastInner(target, propertyKey, descriptor) {
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

export function Http2Poll(serverName: string, pollingTime: number) {
  return function PollInner(target, propertyKey, descriptor) {
    const server = Http2Factory.GetServer(serverName);
    server.emitter.on(`${serverName}:Http2Stream`, function (stream: http2.Http2Stream, headers: http2.ClientSessionRequestOptions) {
      descriptor.value(stream, headers);

      setInterval(() => {
        descriptor.value(stream, headers);
      }, pollingTime);
    });
  };
}

/**
 * broadcast a method to all servers
 *
 * @constructor
 */
export function Broadcast() {
  return function BroadcastInner(target, propertyKey, descriptor) {
    const { value } = descriptor;
    descriptor.value = function () {
      value();
      this.emitter.emit('broadcast', propertyKey, ...Object.values(arguments));
    };
  };
};
