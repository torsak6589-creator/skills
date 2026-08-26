/*
 * deck-export-vdo.js — "EXPORT VDO PRESENTATION" for Claude Design decks
 * -------------------------------------------------------------------------
 * Drop-in, dependency-free module that records the deck advancing through
 * every slide and hands the viewer a downloadable video file (.mp4 where the
 * browser supports it, otherwise .webm).
 *
 * Built for "KST Procurement Review Aug 2569.dc.html", but deck-agnostic:
 * it discovers the deck's slides and navigation at runtime instead of relying
 * on private deck-stage.js internals, so it keeps working if that runtime
 * changes. Two capture strategies:
 *
 *   1. "display"  — navigator.mediaDevices.getDisplayMedia (tab capture).
 *                   Highest fidelity: records exactly what is painted,
 *                   including fonts, images, gradients and CSS transitions.
 *                   Requires a one-click permission + surface pick.
 *   2. "canvas"   — SVG <foreignObject> → <canvas> → canvas.captureStream().
 *                   No permission prompt, but cannot paint cross-origin
 *                   images and has weaker CSS coverage. Used as a fallback.
 *
 * Wiring (see README.md): include this file and it self-mounts a floating
 * "Export VDO" button. Override anything via window.KST_VDO_CONFIG before load.
 */
(function () {
  "use strict";

  if (window.__kstVdoExportLoaded) return;
  window.__kstVdoExportLoaded = true;

  // ---- Configuration -----------------------------------------------------
  var CFG = Object.assign(
    {
      // How long to hold each slide on screen while recording (ms).
      perSlideMs: 4500,
      // Extra hold on the first and last slide (ms).
      leadInMs: 800,
      leadOutMs: 1200,
      // Target frame rate.
      fps: 30,
      // Preferred container of the whole deck (auto-detected if null).
      stageSelector: null,
      // Preferred per-slide selector (auto-detected if null).
      slideSelector: null,
      // 'auto' | 'display' | 'canvas'
      captureMode: "auto",
      // Base name for the downloaded file (no extension).
      fileName: "KST-Procurement-Review-Aug-2569",
      // Codecs tried in order; first supported one wins.
      mimeCandidates: [
        "video/mp4;codecs=avc1.42E01E",
        "video/mp4",
        "video/webm;codecs=vp9",
        "video/webm;codecs=vp8",
        "video/webm",
      ],
      // Recording bitrate (bits/sec).
      videoBitsPerSecond: 8_000_000,
      // Auto-mount the floating button.
      mountButton: true,
    },
    window.KST_VDO_CONFIG || {}
  );

  // ---- Small utilities ---------------------------------------------------
  var sleep = function (ms) {
    return new Promise(function (r) {
      setTimeout(r, ms);
    });
  };

  function log() {
    try {
      console.log.apply(console, ["[VDO]"].concat([].slice.call(arguments)));
    } catch (e) {}
  }

  function pickMime() {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return "";
    for (var i = 0; i < CFG.mimeCandidates.length; i++) {
      if (MediaRecorder.isTypeSupported(CFG.mimeCandidates[i])) {
        return CFG.mimeCandidates[i];
      }
    }
    return "";
  }

  function extForMime(mime) {
    return mime && mime.indexOf("mp4") !== -1 ? "mp4" : "webm";
  }

  // ---- Slide / navigation discovery -------------------------------------
  // Returns { count, goTo(i), current(), stageEl } or null if not found.
  function discoverDeck() {
    // 1) Known deck-stage.js style globals.
    var candidates = [
      window.deck,
      window.stage,
      window.Deck,
      window.DeckStage,
      window.__deck,
      window.presentation,
    ].filter(Boolean);

    for (var c = 0; c < candidates.length; c++) {
      var d = candidates[c];
      var goFn =
        pickFn(d, ["goTo", "goto", "showSlide", "show", "select", "seek"]) ||
        null;
      var countVal = pickCount(d);
      if (goFn && countVal > 1) {
        var idxGet = makeIndexGetter(d);
        return {
          count: countVal,
          goTo: function (i) {
            return goFn.call(d, i);
          },
          current: idxGet,
          stageEl: findStageEl(),
          source: "api",
        };
      }
    }

    // 2) DOM-based discovery.
    var slides = findSlides();
    if (slides.length > 1) {
      var nav = makeDomNavigator(slides);
      return {
        count: slides.length,
        goTo: nav.goTo,
        current: nav.current,
        stageEl: findStageEl() || slides[0].parentElement,
        slides: slides,
        source: "dom",
      };
    }
    return null;
  }

  function pickFn(obj, names) {
    for (var i = 0; i < names.length; i++) {
      if (typeof obj[names[i]] === "function") return obj[names[i]];
    }
    return null;
  }

  function pickCount(obj) {
    var keys = ["length", "count", "slideCount", "total", "numSlides"];
    for (var i = 0; i < keys.length; i++) {
      var v = obj[keys[i]];
      if (typeof v === "number" && v > 0) return v;
    }
    var arr = obj.slides || obj.artboards || obj.pages;
    if (arr && typeof arr.length === "number") return arr.length;
    return 0;
  }

  function makeIndexGetter(obj) {
    return function () {
      var keys = ["index", "current", "currentIndex", "activeIndex", "i"];
      for (var i = 0; i < keys.length; i++) {
        if (typeof obj[keys[i]] === "number") return obj[keys[i]];
      }
      return 0;
    };
  }

  function findStageEl() {
    if (CFG.stageSelector) {
      var el = document.querySelector(CFG.stageSelector);
      if (el) return el;
    }
    var sel = [
      ".deck-stage",
      "#deck-stage",
      ".stage",
      "#stage",
      "[data-deck-stage]",
      ".deck",
      "main",
    ];
    for (var i = 0; i < sel.length; i++) {
      var e = document.querySelector(sel[i]);
      if (e) return e;
    }
    return document.body;
  }

  function findSlides() {
    if (CFG.slideSelector) {
      return toArr(document.querySelectorAll(CFG.slideSelector));
    }
    var sel = [
      "[data-slide]",
      ".dc-artboard",
      ".artboard",
      ".slide",
      "section.slide",
      ".deck-slide",
      "[data-artboard]",
      "section[data-index]",
    ];
    var best = [];
    for (var i = 0; i < sel.length; i++) {
      var nodes = toArr(document.querySelectorAll(sel[i]));
      if (nodes.length > best.length) best = nodes;
    }
    return best;
  }

  function toArr(nl) {
    return Array.prototype.slice.call(nl);
  }

  // DOM navigator: show one slide at a time. Prefers the deck's own controls
  // (keyboard / next button); falls back to toggling visibility directly.
  function makeDomNavigator(slides) {
    var idx = 0;

    function activateByClass(i) {
      slides.forEach(function (s, k) {
        var on = k === i;
        s.classList.toggle("active", on);
        s.classList.toggle("is-active", on);
        s.classList.toggle("current", on);
        // As a last resort, force display so exactly one is visible.
        if (slides.length && !hasDeckControls()) {
          s.style.display = on ? "" : "none";
        }
      });
    }

    function hasDeckControls() {
      return !!(
        document.querySelector("[data-next], .next, .deck-next") ||
        window.deck ||
        window.stage
      );
    }

    return {
      goTo: function (i) {
        idx = Math.max(0, Math.min(slides.length - 1, i));
        // Try scrolling the target into view first (scroll-snap decks).
        try {
          slides[idx].scrollIntoView({ behavior: "instant", block: "center" });
        } catch (e) {
          try {
            slides[idx].scrollIntoView();
          } catch (e2) {}
        }
        activateByClass(idx);
        // Nudge deck runtimes that listen for hashchange / keyboard.
        dispatchKey("ArrowRight", i > idx ? i - idx : 0);
        return Promise.resolve();
      },
      current: function () {
        return idx;
      },
    };
  }

  function dispatchKey(key, times) {
    for (var t = 0; t < (times || 0); t++) {
      var ev = new KeyboardEvent("keydown", {
        key: key,
        code: key,
        bubbles: true,
      });
      document.dispatchEvent(ev);
    }
  }

  // ---- Capture strategies ------------------------------------------------
  function chooseMode() {
    if (CFG.captureMode !== "auto") return CFG.captureMode;
    var canDisplay =
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.getDisplayMedia === "function";
    return canDisplay ? "display" : "canvas";
  }

  function recordStream(stream, driveFn) {
    return new Promise(function (resolve, reject) {
      var mime = pickMime();
      var opts = { videoBitsPerSecond: CFG.videoBitsPerSecond };
      if (mime) opts.mimeType = mime;
      var rec;
      try {
        rec = new MediaRecorder(stream, opts);
      } catch (e) {
        try {
          rec = new MediaRecorder(stream);
        } catch (e2) {
          return reject(e2);
        }
      }
      var chunks = [];
      rec.ondataavailable = function (e) {
        if (e.data && e.data.size) chunks.push(e.data);
      };
      rec.onerror = function (e) {
        reject(e.error || e);
      };
      rec.onstop = function () {
        resolve(new Blob(chunks, { type: rec.mimeType || mime || "video/webm" }));
      };
      rec.start(250);
      Promise.resolve()
        .then(driveFn)
        .then(function () {
          // Let the last frame settle before stopping.
          return sleep(200);
        })
        .then(function () {
          if (rec.state !== "inactive") rec.stop();
        })
        .catch(function (err) {
          if (rec.state !== "inactive") rec.stop();
          reject(err);
        });
    });
  }

  // Strategy 1: tab/screen capture.
  function captureViaDisplay(deck, onProgress) {
    return navigator.mediaDevices
      .getDisplayMedia({
        video: { frameRate: CFG.fps },
        audio: false,
        preferCurrentTab: true, // Chromium hint; ignored elsewhere.
      })
      .then(function (stream) {
        var blobP = recordStream(stream, function () {
          return driveSlides(deck, onProgress);
        });
        return blobP.finally(function () {
          stream.getTracks().forEach(function (t) {
            t.stop();
          });
        });
      });
  }

  // Strategy 2: render slides onto a canvas via SVG foreignObject.
  function captureViaCanvas(deck, onProgress) {
    var stage = deck.stageEl || findStageEl();
    var rect = stage.getBoundingClientRect();
    var W = Math.max(2, Math.round(rect.width)) || 1280;
    var H = Math.max(2, Math.round(rect.height)) || 720;
    var canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    var ctx = canvas.getContext("2d");
    var stream = canvas.captureStream(CFG.fps);

    var stop = false;
    // Continuously repaint the current stage onto the canvas.
    function paintLoop() {
      if (stop) return;
      renderElementToCanvas(stage, ctx, W, H)
        .catch(function () {})
        .then(function () {
          if (!stop) requestAnimationFrame(paintLoop);
        });
    }
    paintLoop();

    return recordStream(stream, function () {
      return driveSlides(deck, onProgress);
    }).finally(function () {
      stop = true;
      stream.getTracks().forEach(function (t) {
        t.stop();
      });
    });
  }

  function renderElementToCanvas(el, ctx, W, H) {
    return new Promise(function (resolve, reject) {
      var clone = el.cloneNode(true);
      inlineStyles(el, clone);
      var xml = new XMLSerializer().serializeToString(clone);
      var svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="' +
        W +
        '" height="' +
        H +
        '"><foreignObject width="100%" height="100%">' +
        '<div xmlns="http://www.w3.org/1999/xhtml">' +
        xml +
        "</div></foreignObject></svg>";
      var img = new Image();
      var url =
        "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
      img.onload = function () {
        ctx.fillStyle = getComputedStyle(el).backgroundColor || "#fff";
        ctx.fillRect(0, 0, W, H);
        try {
          ctx.drawImage(img, 0, 0, W, H);
          resolve();
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  // Inline computed styles so foreignObject renders faithfully.
  function inlineStyles(src, dst) {
    var cs = getComputedStyle(src);
    var css = "";
    for (var i = 0; i < cs.length; i++) {
      var p = cs[i];
      css += p + ":" + cs.getPropertyValue(p) + ";";
    }
    dst.setAttribute("style", css);
    var sc = src.children,
      dc = dst.children;
    for (var j = 0; j < sc.length; j++) {
      if (dc[j]) inlineStyles(sc[j], dc[j]);
    }
  }

  // ---- Drive the deck through every slide --------------------------------
  function driveSlides(deck, onProgress) {
    var n = deck.count;
    var chain = Promise.resolve();
    for (var i = 0; i < n; i++) {
      (function (i) {
        chain = chain
          .then(function () {
            return deck.goTo(i);
          })
          .then(function () {
            onProgress && onProgress(i + 1, n);
            var hold = CFG.perSlideMs;
            if (i === 0) hold += CFG.leadInMs;
            if (i === n - 1) hold += CFG.leadOutMs;
            return sleep(hold);
          });
      })(i);
    }
    return chain;
  }

  // ---- Download ----------------------------------------------------------
  function download(blob) {
    var ext = extForMime(blob.type);
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = CFG.fileName + "." + ext;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      a.remove();
    }, 4000);
  }

  // ---- Public run --------------------------------------------------------
  var running = false;
  function exportVdo(ui) {
    if (running) return Promise.resolve();
    var deck = discoverDeck();
    if (!deck) {
      var msg =
        "Could not find deck slides. Set window.KST_VDO_CONFIG.slideSelector " +
        "to your slide element selector and reload.";
      ui && ui.error(msg);
      log(msg);
      return Promise.reject(new Error(msg));
    }
    log("deck discovered via", deck.source, "slides:", deck.count);
    running = true;
    var startIdx = deck.current ? deck.current() : 0;
    var mode = chooseMode();
    ui && ui.start(deck.count, mode);

    var progress = function (i, n) {
      ui && ui.progress(i, n);
    };

    var run =
      mode === "display"
        ? captureViaDisplay(deck, progress)
        : captureViaCanvas(deck, progress);

    return run
      .then(function (blob) {
        download(blob);
        ui && ui.done(blob);
      })
      .catch(function (err) {
        log("export failed", err);
        // If display capture was cancelled/blocked, offer canvas fallback.
        if (mode === "display" && CFG.captureMode === "auto") {
          ui && ui.fallback();
          return captureViaCanvas(deck, progress).then(function (blob) {
            download(blob);
            ui && ui.done(blob);
          });
        }
        ui && ui.error((err && err.message) || String(err));
        throw err;
      })
      .finally(function () {
        running = false;
        try {
          deck.goTo(startIdx);
        } catch (e) {}
      });
  }

  window.KSTExportVDO = exportVdo;

  // ---- Floating UI -------------------------------------------------------
  function mountUI() {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "● Export VDO";
    btn.setAttribute("aria-label", "Export presentation as video");
    Object.assign(btn.style, {
      position: "fixed",
      right: "18px",
      bottom: "18px",
      zIndex: "2147483000",
      font: "600 14px/1 system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
      color: "#fff",
      background: "#c0392b",
      border: "none",
      borderRadius: "999px",
      padding: "12px 18px",
      boxShadow: "0 4px 16px rgba(0,0,0,.25)",
      cursor: "pointer",
    });

    var status = document.createElement("div");
    Object.assign(status.style, {
      position: "fixed",
      right: "18px",
      bottom: "62px",
      zIndex: "2147483000",
      font: "500 13px/1.4 system-ui, sans-serif",
      color: "#fff",
      background: "rgba(20,20,20,.9)",
      borderRadius: "10px",
      padding: "10px 14px",
      maxWidth: "280px",
      display: "none",
      boxShadow: "0 4px 16px rgba(0,0,0,.3)",
    });

    document.body.appendChild(btn);
    document.body.appendChild(status);

    function show(text) {
      status.textContent = text;
      status.style.display = "block";
    }

    var ui = {
      start: function (n, mode) {
        btn.disabled = true;
        btn.style.opacity = "0.6";
        btn.textContent = "● Recording…";
        show(
          (mode === "display"
            ? "Recording tab — please don't switch away. "
            : "Rendering slides — please wait. ") +
            n +
            " slides."
        );
      },
      progress: function (i, n) {
        show("Recording slide " + i + " / " + n + "…");
      },
      fallback: function () {
        show("Screen capture unavailable — using canvas render fallback…");
      },
      done: function (blob) {
        btn.disabled = false;
        btn.style.opacity = "1";
        btn.textContent = "● Export VDO";
        var mb = (blob.size / 1048576).toFixed(1);
        show("Done ✓ Downloaded (" + mb + " MB).");
        setTimeout(function () {
          status.style.display = "none";
        }, 6000);
      },
      error: function (m) {
        btn.disabled = false;
        btn.style.opacity = "1";
        btn.textContent = "● Export VDO";
        show("Export failed: " + m);
      },
    };

    btn.addEventListener("click", function () {
      exportVdo(ui);
    });
  }

  if (CFG.mountButton) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", mountUI);
    } else {
      mountUI();
    }
  }
})();
