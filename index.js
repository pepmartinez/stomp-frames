'use strict';

var util =    require ('util');
var Buffers = require ('buffers');
var _ =       require ('lodash');

var EventEmitter = require('events').EventEmitter;


const RS_INIT =      1;
const RS_HDRS =      2;
const RS_BODY =      3;
const RS_BODY_CL =   4;
const RS_BODY_ZERO = 5;
const RS_TRAIL =     6;


const Commands = {
  CONNECT:     'CONNECT',
  STOMP:       'STOMP',
  CONNECTED:   'CONNECTED',
  SEND:        'SEND',
  SUBSCRIBE:   'SUBSCRIBE',
  UNSUBSCRIBE: 'UNSUBSCRIBE',
  ACK:         'ACK',
  NACK:        'NACK',
  BEGIN:       'BEGIN',
  COMMIT:      'COMMIT',
  ABORT:       'ABORT',
  DISCONNECT:  'DISCONNECT',
  MESSAGE:     'MESSAGE',
  RECEIPT:     'RECEIPT',
  ERROR:       'ERROR'
};


const MandatoryHeaders = {
  CONNECT:     ['accept-version', 'host'],
  STOMP:       ['accept-version', 'host'],
  CONNECTED:   ['version'],
  SEND:        ['destination'],
  SUBSCRIBE:   ['destination', 'id'],
  UNSUBSCRIBE: ['id'],
  ACK:         ['id'],
  NACK:        ['id'],
  BEGIN:       ['transaction'],
  COMMIT:      ['transaction'],
  ABORT:       ['transaction'],
  DISCONNECT:  [],
  MESSAGE:     ['destination', 'message-id', 'subscription'],
  RECEIPT:     ['receipt-id'],
  ERROR:       [],
};


class Frame {
  constructor () {
    this.clear ();
  }

  command (p) {
    if (p) {
      if (!Commands[p]) throw Error ('unrecognized STOMP command ' + p);
      this._cmd = p;
    }
    else return this._cmd;
  }

  headers (p) {
    if (p) this._headers = p;
    else return this._headers;
  }

  body (p) {
    if (p) this._body = p;
    else return this._body;

    //  TODO add encoding mgmt
  }

  header (k, v) {
    if (v) this._headers[this._dec_hdr (k)] = this._dec_hdr (v);
    else return this._headers[k];
  }

  ctype (v) {
    if (v) this._headers['content-type'] = v;
    else return this._headers['content-type'];
  }

  clear () {
    this._cmd = 0;
    this._headers = {};
    this._body = null;
  }

  write (socket, cb) {
    // add calculated headers
    if (this._body) {
      this._headers['content-length'] = Buffer.byteLength (this._body) + '';
    }

    // dump command
    var b = Buffers ();
    b.push (Buffer.from (this._cmd + '\n'));

    _.forEach (this._headers, (v, k) => b.push (Buffer.from (this._enc_hdr (k) + ':' + this._enc_hdr (v) + '\n')));

    if (this._body) {
      if (_.isBuffer (this._body)){
        b.push (Buffer.from ('\n'));
        b.push (this._body);
        b.push (Buffer.from ('\0'));
      }
      else {
        b.push (Buffer.from ('\n' + this._body + '\0'));
      }
    }
    else {
      b.push (Buffer.from ('\n\0'));
    }

    socket.write (b.toBuffer (), cb);
  }

  _enc_hdr (v) {
    var ret = v;

    _.forEach ([
      [/\\/g, '\\\\'],
      [/\r/g, '\\r'],
      [/\n/g, '\\n'],
      [/:/g, '\\c']
    ], function (subst) {
      ret = ret.replace(subst[0], subst[1]);
    });

    return ret;
  }

  _dec_hdr (v) {
    var ret = v;

    _.forEach ({
      '\\r': '\r',
      '\\n': '\n',
      '\\c': ':',
      '\\\\': '\\'
    }, function (sub_v, sub_k) {
      ret = ret.replace(sub_k, sub_v);
    });

    return ret;
  }

  _semantic_validation () {
    // header glitch: treat message-id as alias to id in ACK and NACK
    if ((this._cmd == Commands.ACK) || (this._cmd == Commands.NACK)) {
      var id = this.header ('id');
      var msgid = this.header ('message-id');
      if (!id && msgid) this.header ('id', msgid);
    }

    var must_have_headers = MandatoryHeaders[this._cmd];
    if (!must_have_headers) return null;

    for (var i = 0; i < must_have_headers.length; i++) {
      var h = must_have_headers[i];
      var hv = this.header(h);

      if (_.isUndefined (hv)) {
        return util.format ('missing mandatory header [%s] on frame [%s]', h, this._cmd);
      }
      else {
        this[h] = hv;
      }
    }

    // post process
    if (this['accept-version']) {
      // break it down
      let arr = this['accept-version'].split (',');
      this['accept-version'] = {};
      _.forEach (arr, v => {this['accept-version'][v.trim ()] = true;});
    }

    switch (this._cmd) {
      case Commands.SUBSCRIBE:
        let ack_hdr = this.header ('ack');
        if (ack_hdr) {
          if ((ack_hdr != 'auto') && (ack_hdr != 'client') && (ack_hdr != 'client-individual')) {
            return util.format ('invalid value for ack header [%s] on frame [%s]', ack_hdr, this._cmd);
          }

          this.ack = ack_hdr;
        }
        break;

      case Commands.CONNECT:
      case Commands.STOMP:
      case Commands.CONNECTED:
        let hb_hdr = this.header ('heart-beat');
        if (hb_hdr) {
          if (!hb_hdr.match (/[0-9]+,[0-9]+/)) {
            return util.format ('invalid value for heart-beat header [%s] on frame [%s]', hb_hdr, this._cmd);
          }

          let arr = hb_hdr.split(',');
          this['heart-beat'] = [parseInt(arr[0]), parseInt(arr[1])];
        }
        break;
    }

    return null;
  }
}



class StompSession extends EventEmitter {
  constructor (socket) {
    super ();
    this._s = socket;
    this._clear_state();

    this._last_read =  new Date();
    this._last_write = new Date();

    var self = this;
    this._s.on ('data', function (data) {
      self._last_read = new Date();
      self._read_buffer.push (data);

      // TODO check a max size is buffered only
      self._incr_parse ();
    });
  }


  ///////////////////////////////
  end () {
    this._s.end ();
  }


  ///////////////////////////////
  destroy () {
    this._s.destroy ();
  }


  ///////////////////////////////
  last_read () {
    return this._last_read;
  }


  ///////////////////////////////
  last_write () {
    return this._last_write;
  }


  ///////////////////////////////
  ping () {
    // send EOL
    this._s.write ('\n');
    this._last_write = new Date();
  }


  ///////////////////////////////
  send (frm) {
    frm.write (this._s);
    this._last_write = new Date();
  }

  ///////////////////////////////
  _read_line () {
    if (this._read_buffer.length <= (this._read_ptr + 1)) {
      // console.log ('empty buffer');
      return null;
    }

    var idx = this._read_buffer.indexOf ('\n', this._read_ptr);
    if (idx == -1) {
      // console.log ('no line left. buffer left is [%s]', this._read_buffer.slice (this._read_ptr));
      return null;
    }

    var line_buf = this._read_buffer.slice (this._read_ptr, idx + 1);
    var line = line_buf.toString ('utf8').trim ();
    // console.log ('read line [%s], old idx %d, new idx %d. %d bytes left in buffer', line, this._read_ptr, idx + 1, this._read_buffer.length - idx - 1);
    this._read_ptr = idx + 1;
    return line;
  }


  ////////////////////////////////////////
  _add_header_line (line) {
    var sep = line.indexOf (':');
    if (sep == -1) return false;
    var k = line.slice (0, sep);
    var v = line.slice (sep + 1);

    // console.log ('added header [%s] -> [%s]', k, v);
    this._in_frame.header (k, v);
    return true;
  }


  ///////////////////////////////////////
  send_error (e) {
    var f = new Frame ();
    f.command (Commands.ERROR);
    f.header ('message', e.message || e);
    f.body (e.message || e);
    this.send (f);
    this._s.destroy ();
  }


  ///////////////////////////////////////
  _manage_error (e) {
    this._clear_state ();

    if (this.listenerCount ('error')) {
      this.emit ('error', e);
    }
    else {
      this.send_error (e);
    }
  }


  ///////////////////////////////////////
  _clear_state () {
    this._read_buffer = Buffers();
    this._read_ptr = 0;
    this._read_stage = RS_INIT;
    this._in_frame = new Frame ();
  }


  ///////////////////////////////////////
  _semantic_validation () {
    return this._in_frame._semantic_validation ();
  }


  ///////////////////////////////////////
  _got_a_frame () {
    var err = this._semantic_validation ();

    if (err) {
      this._manage_error (err);
      return false;
    }

    var rem_buffer = this._read_buffer.slice (this._read_ptr);
    this._read_buffer = Buffers();
    this._read_buffer.push (rem_buffer);
    this._read_ptr = 0;
    this._read_stage = RS_INIT;
    if (this._in_frame.clen) delete this._in_frame.clen;

    this.emit ('frame', this._in_frame);

    this._in_frame = new Frame ();
    return true;
  }


  ///////////////////////////////////////
  _incr_parse () {
    for (;;) {
      switch (this._read_stage) {
        case RS_INIT:
          var line = this._read_line ();
          if (line === null) return;  // not enough data
          if (line.length == 0) break; // empty lines before frame

          try {
            this._in_frame.command (line);
            this._read_stage = RS_HDRS;
            //console.log ('cmd read, now moving to RS_HDRS');
          }
          catch (e) {
            // unknown command:
            this._manage_error (e);
          }
          break;

        case RS_HDRS:
          var line = this._read_line ();
          if (line === null) return;
          if (line.length == 0) {
            // move to read body
            this._read_stage = RS_BODY;
            //console.log ('hdrs read, now moving to RS_BODY');
          }
          else {
            try {
              this._add_header_line (line);
            }
            catch (e) {
              // bad header
              this._manage_error (e);
            }
          }
          break;

        case RS_BODY:
          // see if we got content-len or not
          if (this._in_frame.header ('content-length')) {
            this._in_frame.clen = parseInt (this._in_frame.header ('content-length'));
            //console.log ('content-len seen to be %d', this._in_frame.clen);
            this._read_stage = RS_BODY_CL;
          }
          else {
            this._read_stage = RS_BODY_ZERO;
          }
          break;

        case RS_BODY_CL:
          // console.log ('buffer remaining is %d bytes, need %d', this._read_buffer.length - this._read_ptr, this._in_frame.clen);
          if ((this._read_buffer.length - this._read_ptr) < (this._in_frame.clen + 1)) return;

          // TODO manage non-text bodies

          const b_body = this._read_buffer.slice (this._read_ptr, this._in_frame.clen + this._read_ptr);
          const ct = this._in_frame.header ('content-type');

          if (ct) {
            if (
              ct.match (/^text\//) ||
              ct.match (/^application\/json/)
            ){
              this._in_frame.body (b_body.toString ('utf8'));
            }
            else {
              // as buffer if there's ctype but iy's not a text one
              this._in_frame.body (b_body);
            }
          }
          else {
            // as string if there is no ctype
            this._in_frame.body (b_body.toString ('utf8'));
          }

          // reset buffer & ptr
          this._read_ptr = this._in_frame.clen + this._read_ptr + 1;
          this._got_a_frame ();
          break;

        case RS_BODY_ZERO:
          var idx = this._read_buffer.indexOf ('\0', this._read_ptr);
          if (idx < 0) return;

          this._in_frame.body (this._read_buffer.slice (this._read_ptr, idx).toString ('utf8'));

          // reset buffer & ptr
          this._read_ptr = idx + 1;
          this._got_a_frame ();
          break;

        case RS_TRAIL:
          break;
      }
    }
  }
}


module.exports = {
  Commands: Commands,
  Frame: Frame,
  StompSession: StompSession
};
