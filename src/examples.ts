// import { Http2 } from './index';
//
// const { Http2Factory, Http2Listener, Http2SessionListener, Http2Poll, ServerBroadcast } = Http2;

import { Http2Factory, Http2Listener, Http2SessionListener, Http2Poll, ServerBroadcast } from 'http2-helper';

// const options = {
//   key: getKeySomehow(),
//   cert: getCertSomehow()
// };

const server = Http2Factory.Create('test');
server.listen(8000);

/**
 * examples of actions taken on ALL servers
 */
// Http2Factory.DisconnectAll(); // disconnect all servers

// setTimeout(() => {
//   Http2Factory.WriteAll('writing to all servers!');
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
  private thisWillBeAStreamHandler(stream, headers) {
    /**
     * the listeners will be run in the order they are declared, so we can safely handle the initial handshake as part
     * of the first method
     */
    stream.respond({ ':status': 200, 'content-type': 'text/plain' });
    stream.write('hello ');

    for (let i = 5; i > 0; i--) {
      stream.write('hello ');
    }
  };

  /**
   * sometimes we might want to listen to the session event like this
   *
   * @param session
   * @private
   */
  @Http2SessionListener('test')
  private thisWillBeASessionHandler(session) {
    console.log('a session!', session);
  }

  /**
   * commonly we might need to poll for data and then write back to a client
   *
   * @param stream
   * @param headers
   * @private
   */
  @Http2Poll('test', 5000)
  private thisWillBeAPollingMethod(stream, headers) {
    stream.write('polling...');
  }

  /**
   * broadcast the output of this method to the entire server. These methods are actually expected to be called. They
   * are not event listeners. Good for sending system wide messages e.g maintenance warnings
   */
  @ServerBroadcast('test')
  public broadcastTheOutput() {
    return 'a whole new wooooorld';
  }
}

const example = new Example();

/**
 * need to have time to open the client to test this
 */
setTimeout(() => {
  example.broadcastTheOutput();
}, 8000);
