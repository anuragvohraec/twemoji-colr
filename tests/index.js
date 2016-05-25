'use strict';

var ComparisonTest = function(codePoints) {
  this.codePoints = codePoints;
  this.string = this.codePointsToString(codePoints);
};

ComparisonTest.prototype = {
  FONT_NAME: 'EmojiOne Mozilla',
  CANVAS_SIZE: 640,
  SVG_SIZE: 64,
  LINE_HEIGHT: 640,

  run: function() {
    return this.runCanvases()
      .then(this.runSVGImageCompare.bind(this))
      .then(this.runCanvasesCompare.bind(this))
      .then(function() {
        return this;
      }.bind(this));
  },

  runCanvases: function() {
    return Promise.all([
        this.getSystemRenderingCanvas(),
        this.getEmojiRenderingCanvas(),
        this.getSVGRenderingCanvas()
      ])
      .then(function(values) {
        this.systemRenderingCanvas = values[0];
        this.emojiRenderingCanvas = values[1];
        this.svgRenderingCanvas = values[2];
      }.bind(this));
  },

  runSVGImageCompare: function() {
    return this.imageCompare(this.svgRenderingCanvas, this.emojiRenderingCanvas)
      .then(function(resambleDiffData) {
        var img = new Image();
        img.src = resambleDiffData.getImageDataUrl();

        this.svgRenderingDiffImg = img;
        this.svgRenderingMisMatchPercentage =
          resambleDiffData.rawMisMatchPercentage;
      }.bind(this));
  },

  runCanvasesCompare: function() {
    this.isEqualToSystem = this.canvasEqual(
      this.systemRenderingCanvas, this.emojiRenderingCanvas);
    this.emojiRenderingEmpty =
      this.canvasEmpty(this.emojiRenderingCanvas);
    this.svgRenderingEmpty =
      this.canvasEmpty(this.svgRenderingCanvas);
  },

  codePointsToString: function(codePoints) {
    var string = String.fromCodePoint.apply(String, codePoints);
    if (codePoints.length === 1 && codePoints[0] < 0xffff) {
      // Force Emoji style w/ VS16
      string += '\ufe0f';
    }

    return string;
  },

  getEmptyCanvas: function() {
    var canvas = document.createElement('canvas', { willReadFrequently: true });
    canvas.width = this.CANVAS_SIZE;
    canvas.height = this.CANVAS_SIZE;

    return canvas;
  },

  getTextCanvasWithFont: function(fontName) {
    var canvas = this.getEmptyCanvas();
    var ctx = canvas.getContext('2d');
    ctx.font = this.CANVAS_SIZE + 'px ' + fontName;
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'center';
    ctx.fillText(this.string, this.CANVAS_SIZE / 2, this.LINE_HEIGHT);

    return canvas;
  },

  getSystemRenderingCanvas: function() {
    return this.getTextCanvasWithFont();
  },

  getEmojiRenderingCanvas: function() {
    return this.getTextCanvasWithFont(this.FONT_NAME);
  },

  getSVGRenderingCanvas: function() {
    var svgUrl = '../build/colorGlyphs/u' +
      this.codePoints.filter(function(cp) {
        // Remove zero width joiner.
        return cp !== 0x200d;
      })
      .map(function(cp) {
        var str = cp.toString(16);
        while (str.length < 4) {
          str = '0' + str;
        }
        return str;
      }).join('-') + '.svg';
    return new Promise(function(resolve) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', svgUrl, true);
        xhr.responseType = 'text';
        xhr.send();
        xhr.onloadend = function() {
          resolve(xhr.response);
        };
      })
      .then(function(svgText) {
        if (svgText.substr(0, 5) !== '<svg ') {
          return;
        }

        // Gecko bug 700533. I love my job.
        svgText = '<svg width="' +
          this.SVG_SIZE + 'px" height="' +
          this.SVG_SIZE + 'px" ' +
          svgText.substr(5);
        return 'data:image/svg+xml,' + encodeURIComponent(svgText);
      }.bind(this))
      .then(function(svgDataUrl) {
        if (!svgDataUrl) {
          return;
        }

        return new Promise(function(resolve) {
          var svgImg = new Image();
          svgImg.src = svgDataUrl;
          svgImg.onload = function() {
            resolve(svgImg);
          };
        }.bind(this));
      }.bind(this))
      .then(function(img) {
        var canvas = this.getEmptyCanvas();
        if (img) {
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, this.SVG_SIZE, this.SVG_SIZE,
            0, 0, this.CANVAS_SIZE, this.CANVAS_SIZE);
        }

        return canvas;
      }.bind(this));
  },

  canvasEqual: function(aCanvas, bCanvas) {
    var aImageDataArr = this.getImageDataArray(aCanvas);
    var bImageDataArr = this.getImageDataArray(bCanvas);

    for (var i = 0; i < aImageDataArr.length; i++) {
      if (aImageDataArr[i] !== bImageDataArr[i]) {
        return false;
      }
    }

    return true;
  },

  imageCompare: function(aCanvas, bCanvas) {
    return Promise.all([
        new Promise(function(res) { aCanvas.toBlob(res) }),
        new Promise(function(res) { bCanvas.toBlob(res) })
      ])
      .then(function(blobs) {
        return new Promise(function(resolve) {
          resemble(blobs[0])
            .compareTo(blobs[1])
            .ignoreAntialiasing()
            .onComplete(resolve);
        });
      });
  },

  canvasEmpty: function(canvas) {
    var imageDataArr = this.getImageDataArray(canvas);

    for (var i = 0; i < imageDataArr.length; i++) {
      if (imageDataArr[i]) {
        return false;
      }
    }

    return true;
  },

  getImageDataArray: function(canvas) {
    return canvas.getContext('2d')
      .getImageData(0, 0, this.CANVAS_SIZE, this.CANVAS_SIZE)
      .data;
  }
};

var TestLoader = function() {
}

TestLoader.prototype = {
  loadCodePointsData: function() {
    return new Promise(function(resolve) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', '../build/codepoints.js', true);
        xhr.responseType = 'json';
        xhr.send();
        xhr.onloadend = function() {
          resolve(xhr.response);
        };
      })
      .then(function(glyphToCodePoints) {
        var codePointsArr = [];
        for (var glyphId in glyphToCodePoints) {
          if (/_layer/.test(glyphId)) {
            continue;
          }

          var codePoints = glyphId.substr(1).split('_')
            .map(function(cpStr) {
              return parseInt(cpStr, 16);
            });

          codePointsArr.push(codePoints);
        }

        return codePointsArr;
      });
  },

  run: function(arr) {
    this.testRunReport = new TestRunReport();
    document.body.appendChild(this.testRunReport.render());

    var codePointsArrPromise;
    if (!arr) {
      codePointsArrPromise = this.loadCodePointsData();
    } else {
      codePointsArrPromise = Promise.resolve(arr);
    }
    return codePointsArrPromise
      .then(function(codePointsArr) {
        var p = Promise.resolve();

        codePointsArr.forEach(function(codePoints, i) {
          p = p.then(function() {
            var comparisonTest = new ComparisonTest(codePoints);
            return comparisonTest.run()
              .then(this.testRunReport.appendResult.bind(this.testRunReport));
          }.bind(this));
        }.bind(this));

        return p;
      }.bind(this))
      .then(function() {
        this.testRunReport.reportFinish();
      }.bind(this),
      function(e) {
        this.testRunReport.reportFinish();
        throw e;
      }.bind(this));
  }
};

function start(arr) {
  if (typeof arr === 'string') {
    arr = arr.split(',').map(function(str) {
      return str.split(' ')
        .map(function(numStr) {
          return numStr = numStr.trim();
        })
        .filter(function(numStr) {
          return (numStr !== '');
        })
        .map(function(numStr) {
        if (numStr.substr(0, 2) === 'U+') {
          numStr = numStr.substr(2);
        }
        return parseInt(numStr, 16);
      });
    });
  }

  (new TestLoader())
    .run(arr)
    .catch(function(e) {
      alert('Open JS Console to see error: ' + e.toString());
      console.error(e);
    });
}

function changeHashAndStart(str) {
  var hashStr = decodeURIComponent(document.location.hash.substr(1));
  if (str === hashStr) {
    start(str);
  } else {
    // trigger a hashchange
    document.location.hash = '#' + str;
  }
}

if (document.location.hash) {
  document.getElementById('codepoints').value =
    decodeURIComponent(document.location.hash.substr(1));
}
window.addEventListener('hashchange', function() {
  var str = decodeURIComponent(document.location.hash.substr(1));
  if (str) {
    start(str);
  }
});

document.body.classList.toggle('hide-passed',
  document.getElementById('hide-passed').checked);
