import { v4 as uuid }                                                               from 'uuid';
import { Http2Factory, Http2Listener, Http2SessionListener, Poll, ServerBroadcast } from './index';

// const options = {
//   key: getKeySomehow(),
//   cert: getCertSomehow()
// };

const server = Http2Factory.Create('test');
server.connect(8000);

/**
 * examples of actions taken on ALL servers
 */
// Http2Factory.disconnect(); // disconnect all servers

// setTimeout(() => {
//   Http2Factory.writeAll('yeet yeet big papa');
// }, 4000);

/**
 * ---------------------------------------------
 */

/**
 * Early example - this method will execute when a connection is made
 */

class Example {
  /**
   * run this method when a stream comes in from a client to the specified server
   *
   * @param stream
   * @param headers
   */
  @Http2Listener('test')
  public thisWillBeAStreamHandler(stream, headers) {
    stream.write('hello ');

    for (let i = 5; i > 0; i--) {
      stream.write('hello ');
    }
  };

  /**
   * broadcast the output of this method to the entire server
   */
  @ServerBroadcast('test')
  public broadcastTheOutput() {
    return 'a whole new wooooorld';
  }

  @ServerBroadcast('test')
  public async broadcastTheOutputAsync() {
    return 'a whole new wooooorld async';
  }

  anotherNonHttp2Method() {
    console.log('things are happening');
  }
}

/**
 * another class that also listens to incoming streams and takes action on them. In this case it just logs our headers
 */

class Example2 {
  @Http2Listener('test')
  public anotherStreamHandler(stream, headers) {
    console.log('headers', headers);
  }

  // send another message 5 seconds after
  @Http2Listener('test')
  public sendSomeMessage(stream, headers) {
    setTimeout(() => {
      stream.write('hello again');
    }, 5000);
  }

  /**
   * run this method when a session is established. can be used to take action on certain origins / metadata
   *
   * @param session
   */
  @Http2SessionListener('test')
  public logStreamOrigins(session) {
    // console.log(session.originSet);
  }

  /**
   * poll on behalf of the client
   *
   * @param stream
   */
  @Poll('test', 5000)
  public pollSomeStuff(stream) {
    const id = uuid();
    stream.write(id);
  }
}

const example = new Example();

/**
 * broadcast test
 */
setTimeout(() => {
  example.broadcastTheOutput();
  example.broadcastTheOutputAsync();
}, 5000);

const example2 = new Example2();

/**
 * this is important: we can now broadcast messages across all live connections enabling system level messaging
 */
setTimeout(() => {
  server.writeAll('yeet yeet');
}, 8000);

/**
 * normal methods work too
 */
example.anotherNonHttp2Method();
