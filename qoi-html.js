/* This Source Code Form is subject to the terms of the Mozilla Public
   License, v. 2.0. If a copy of the MPL was not distributed with this
   file, You can obtain one at http://mozilla.org/MPL/2.0/. */
(function() {
"use strict";

function fetch_img() {
    let img_qoi = document.querySelectorAll('img[type="image/qoi"]');
    //let pic_qoi = document.querySelectorAll('picture source[type="image/qoi"]');
    img_qoi.forEach(function (imgElm) {
        fetch(imgElm.src, {cache:'force-cache'})
          .then(response => {
              if (!response.ok) {
                  throw new Error(`HTTP ${response.status} - ${response.statusText}`);
              }
              return response.arrayBuffer();
          })
          .then(buf => {
              if (buf.byteLength < 22) {  // Total size of header 14 bytes and padding 8 bytes.
                  console.error("Too short byteLength:", buf.byteLength);
                  reject();
              }
              let rawBuffer = new Uint8Array(buf);
              return decode_qoi(rawBuffer, buf.byteLength);
          })
          .then(qoiData => {
              if (qoiData === null) {
                  console.error("Failed to decode.");
                  reject();
              }
              show_img(qoiData, imgElm);
          })
          .catch((reason) => {
              console.error(reason);
          });
    });
    window.removeEventListener('load', fetch_img);
}

// Decoder.
function decode_qoi(arrbuf, byteLen) {
    const uint8 = new Uint8Array(arrbuf, 0, byteLen);
    // Load header items.
    const header = {
      magic: String.fromCharCode(uint8[0],uint8[1],uint8[2],uint8[3]),
      width: ((uint8[4] << 24) | (uint8[5] << 16) | (uint8[6] << 8) | uint8[7]) >>> 0,
      height: ((uint8[8] << 24) | (uint8[9] << 16) | (uint8[10] << 8) | uint8[11]) >>> 0,
      channels: uint8[12],
      colorspace: uint8[13]
    };
    if (header.magic !== 'qoif' || header.channels < 3 || header.channels > 4 || header.colorspace > 1) {
        console.error("decode_qoi: Invalid header:", header);
        return null;
    }

    // Decoding data
    const pxLen = header.width * header.height * header.channels;
    const result = new Uint8Array(pxLen);
    const index_rgba = new Uint32Array(64);
    let arrPos = 14;
    let idxPos = 0;
    let red = 0;
    let green = 0;
    let blue = 0;
    let alpha = 255;
    let run = 0;

    for (let pxlPos = 0; pxlPos < pxLen; pxlPos += header.channels) {
        if (run > 0) {
            run--;
        } else {
            const byte0 = uint8[arrPos++];
            if ((byte0 >> 6) === 0b11) {  // 0b11xxxxxx
                switch (byte0) {
                    case 0b11111110:  // QOI_OP_RGB
                      red = uint8[arrPos];
                      green = uint8[arrPos + 1];
                      blue = uint8[arrPos + 2];
                      arrPos += 3;
                      break;
                    case 0b11111111:  // QOI_OP_RGBA
                      red = uint8[arrPos];
                      green = uint8[arrPos + 1];
                      blue = uint8[arrPos + 2];
                      alpha = uint8[arrPos + 3];
                      arrPos += 4;
                      break;
                    default:  // QOI_OP_RUN
                      run = byte0 & 0b00111111;
                }
            } else {
                switch((byte0 >> 6) & 0b11) {
                    case 0b00:  // 0b00iiiiii: QOI_OP_INDEX
                      red = (index_rgba[byte0] >> 24) & 0xff;
                      green = (index_rgba[byte0] >> 16) & 0xff;
                      blue = (index_rgba[byte0] >> 8) & 0xff;
                      alpha = index_rgba[byte0] & 0xff;
                      break;
                    case 0b01:  // 0b01drdgdb: QOI_OP_DIFF
                      red += ((byte0 >> 4) & 0b11) - 2;
                      green += ((byte0 >> 2) & 0b11) - 2;
                      blue += (byte0 & 0b11) - 2;
                      // handle wraparound
                      red = (red + 256) % 256;
                      green = (green + 256) % 256;
                      blue = (blue + 256) % 256;
                      break;
                    case 0b10:  // 0b10xxxxxx: QOI_OP_LUMA
                      const byte1 = uint8[arrPos++];
                      const greenDiff = (byte0 & 0b00111111) - 32;
                      const redDiff = greenDiff + ((byte1 >> 4) & 0b00001111) - 8;
                      const blueDiff = greenDiff + (byte1 & 0b00001111) - 8;
                      // handle wraparound
                      red = (red + redDiff + 256) % 256;
                      green = (green + greenDiff + 256) % 256;
                      blue = (blue + blueDiff + 256) % 256;
                      break;
                    default:
                }
            }
            idxPos = (red * 3 + green * 5 + blue * 7 + alpha * 11) % 64;
            index_rgba[idxPos] = (red << 24 | green << 16 | blue << 8 | alpha);
        }

        // Set pixels.
        result[pxlPos] = red;
        result[pxlPos + 1] = green;
        result[pxlPos + 2] = blue;
        if (header.channels === 4) { // RGBA
            result[pxlPos + 3] = alpha;
        }
    }

    if (arrPos !== byteLen - 8) {
        console.error('decode_qoi: Lacks some pixel or padding:', 
                      (byteLen - 8 - arrPos), 'bytes.');
    }

    return {
        width: header.width,
        height: header.height,
        colorspace: header.colorspace,
        channels: header.channels,
        data: result
    };
}

function show_img(qoiData, img_elm) {
    // Initialize a new ImageData object.
    const arr = new Uint8ClampedArray(qoiData.data);
    let imgData = new ImageData(arr, qoiData.width, qoiData.height);

    // Draw image data to the canvas.
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = qoiData.width;
    canvas.height = qoiData.height;
    ctx.putImageData(imgData, 0, 0); // data, dx, dy

    // Set img element from canvas image.
    if (!img_elm.hasAttribute('loading') &&
        img_elm.hasAttribute('width') &&
        img_elm.hasAttribute('height')) {
        img_elm.loading = "lazy";
    }
    img_elm.setAttribute('type', 'image/png');
    img_elm.src = canvas.toDataURL();
    canvas.remove();
}

window.addEventListener('load', fetch_img);

})(window);
