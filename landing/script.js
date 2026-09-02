{
  // Same POST the browser used before AJAX. A hidden iframe is the target so
  // the page does not navigate; fetch was dropping Basic Auth on this host.
  const form = document.querySelector(".signup");
  const status = document.querySelector("[data-notify-status]");
  const iframe = document.querySelector("[name=notify-sink]");

  const showNotifyStatus = (ok, flag) => {
    if (!(status instanceof HTMLElement)) {
      return;
    }
    status.hidden = false;
    status.textContent =
      flag === "rate"
        ? "Too many tries. Wait a bit and try again."
        : ok
          ? "You’ll get one email when there’s a build."
          : "That didn’t go through. Check the address and try again.";
    status.classList.toggle("signup__status--ok", ok);
    status.classList.toggle("signup__status--err", !ok);
  };

  if (form instanceof HTMLFormElement && iframe instanceof HTMLIFrameElement) {
    form.target = "notify-sink";

    const ajaxField = document.createElement("input");
    ajaxField.type = "hidden";
    ajaxField.name = "ajax";
    ajaxField.value = "1";
    form.appendChild(ajaxField);

    let expecting = false;

    form.addEventListener("submit", () => {
      expecting = true;
      if (status instanceof HTMLElement) {
        status.hidden = true;
      }
    });

    iframe.addEventListener("load", () => {
      if (!expecting) {
        return;
      }
      expecting = false;

      let ok = false;
      let flag = "error";
      try {
        const text = (iframe.contentDocument?.body?.textContent ?? "").trim();
        const payload = JSON.parse(text);
        ok = payload.ok === true;
        flag = typeof payload.flag === "string" ? payload.flag : flag;
      } catch {
        try {
          const params = new URLSearchParams(iframe.contentWindow?.location.search ?? "");
          if (params.has("notified")) {
            ok = true;
            flag = "notified";
          } else if (params.has("notify-error")) {
            flag = "notify-error";
          }
        } catch {
          ok = false;
        }
      }
      showNotifyStatus(ok, flag);
    });
  }

  const params = new URLSearchParams(window.location.search);
  if (params.has("notified") || params.has("notify-error")) {
    showNotifyStatus(params.has("notified"), params.has("notified") ? "notified" : "notify-error");
    history.replaceState({}, "", window.location.pathname + window.location.hash);
  }
}

const video = document.querySelector(".hero__video");
const chapterButtons = Array.from(document.querySelectorAll(".video-chapter"));

if (video instanceof HTMLVideoElement && chapterButtons.length > 0) {
  const chapters = chapterButtons.map((button) => ({
    button,
    source: button.dataset.src,
  }));

  let currentChapterIndex = 0;
  let animationFrameId = null;

  const updateProgress = () => {
    const currentDuration = Number.isFinite(video.duration) ? video.duration : 0;

    chapters.forEach(({ button }, index) => {
      let progress = 0;

      if (index < currentChapterIndex) {
        progress = 1;
      } else if (index === currentChapterIndex && currentDuration > 0) {
        progress = Math.min(1, Math.max(0, video.currentTime / currentDuration));
      }

      button.style.setProperty("--chapter-progress", `${progress * 100}%`);

      const isCurrent = index === currentChapterIndex;

      if (isCurrent) {
        button.setAttribute("aria-current", "true");
      } else {
        button.removeAttribute("aria-current");
      }
    });
  };

  const updateWhilePlaying = () => {
    updateProgress();

    if (video.paused || video.ended) {
      animationFrameId = null;
      return;
    }

    animationFrameId = requestAnimationFrame(updateWhilePlaying);
  };

  const startProgressAnimation = () => {
    if (animationFrameId === null) {
      animationFrameId = requestAnimationFrame(updateWhilePlaying);
    }
  };

  const playCurrentChapter = () => {
    video.play().catch(() => {
      // The chapter still switches when a browser blocks autoplay.
    });
  };

  const loadChapter = (index, shouldPlay = true) => {
    const chapter = chapters[index];

    if (!chapter?.source) {
      return;
    }

    currentChapterIndex = index;
    updateProgress();

    if (video.getAttribute("src") === chapter.source) {
      video.currentTime = 0;
      updateProgress();
      if (shouldPlay) {
        playCurrentChapter();
      }
      return;
    }

    video.addEventListener(
      "loadedmetadata",
      () => {
        updateProgress();
        if (shouldPlay) {
          playCurrentChapter();
        }
      },
      { once: true },
    );
    video.src = chapter.source;
    video.load();
  };

  chapterButtons.forEach((button, index) => {
    button.addEventListener("click", () => {
      loadChapter(index);
    });
  });

  video.addEventListener("ended", () => {
    loadChapter((currentChapterIndex + 1) % chapters.length);
  });
  video.addEventListener("play", startProgressAnimation);
  video.addEventListener("loadedmetadata", updateProgress);
  video.addEventListener("timeupdate", updateProgress);
  video.addEventListener("seeked", updateProgress);
  video.addEventListener("pause", updateProgress);

  updateProgress();

  if (!video.paused) {
    startProgressAnimation();
  }
}

const gallery = document.querySelector(".widget-gallery__stage");
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

if (gallery instanceof HTMLElement && !prefersReducedMotion.matches) {
  const maxShift = 70;
  let ticking = false;

  const updateParallax = () => {
    ticking = false;

    const rect = gallery.getBoundingClientRect();
    const viewportCenter = window.innerHeight / 2;
    const distanceFromCenter = rect.top + rect.height / 2 - viewportCenter;

    // Progress ramps up as the gallery approaches viewport center, so the
    // rows visibly slide apart while the section scrolls through view.
    const progress = Math.max(-1, Math.min(1, -distanceFromCenter / window.innerHeight));

    gallery.style.setProperty("--gallery-parallax", `${progress * maxShift}px`);
  };

  const onScroll = () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(updateParallax);
    }
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  updateParallax();
}

const widgetPreviewVideos = document.querySelectorAll(".widget-card__video");

widgetPreviewVideos.forEach((previewVideo) => {
  if (!(previewVideo instanceof HTMLVideoElement)) {
    return;
  }

  const card = previewVideo.closest(".widget-card");

  if (!(card instanceof HTMLElement)) {
    return;
  }

  card.addEventListener("pointerenter", (event) => {
    if (event.pointerType !== "mouse") {
      return;
    }

    previewVideo.play().catch(() => {
      // Keep the first frame visible if playback is blocked by the browser.
    });
  });

  card.addEventListener("pointerleave", (event) => {
    if (event.pointerType !== "mouse") {
      return;
    }

    previewVideo.pause();

    if (previewVideo.readyState >= HTMLMediaElement.HAVE_METADATA) {
      previewVideo.currentTime = 0;
    }
  });
});

/* Alle, nicht die erste: die Seite trägt zwei Taskbars, eine über dem Nachbau
   und eine über dem Playground ganz unten. Mit querySelector zeigte die zweite
   für immer die 10:42 aus dem Markup. */
const trayTimes = document.querySelectorAll("[data-wiz-clock-time]");
const trayDates = document.querySelectorAll("[data-wiz-clock-date]");

const tickTrayClock = () => {
  const now = new Date();

  const time = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);
  const date = new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
  }).format(now);

  for (const element of trayTimes) element.textContent = time;
  for (const element of trayDates) element.textContent = date;
};

tickTrayClock();
window.setInterval(tickTrayClock, 15_000);

const wizardWrap = document.querySelector(".wiz-stage-wrap");
const wizardStage = document.querySelector(".wiz-stage");
const wizardDemo = document.querySelector(".wiz-demo");

if (wizardDemo instanceof HTMLElement) {
  const composer = wizardDemo.querySelector(".wiz-composer-editor");
  const sendButton = wizardDemo.querySelector(".wiz-send");
  const plusButton = wizardDemo.querySelector("[data-wiz-plus]");
  const plusMenu = wizardDemo.querySelector(".wiz-plus-menu");
  const picker = wizardDemo.querySelector("[data-wiz-picker]");
  const pickerToggle = wizardDemo.querySelector("[data-wiz-picker-toggle]");
  const pickerList = wizardDemo.querySelector("[data-wiz-picker-list]");
  const pickerRoot = wizardDemo.querySelector("[data-wiz-picker-root]");
  const pickerSections = wizardDemo.querySelectorAll("[data-wiz-picker-section]");

  const composerIsEmpty = (node) => (node.textContent ?? "").trim() === "";

  const syncComposer = () => {
    if (!(composer instanceof HTMLElement) || !(sendButton instanceof HTMLButtonElement)) {
      return;
    }

    const empty = composerIsEmpty(composer);
    composer.classList.toggle("wiz-composer-editor--empty", empty);
    sendButton.disabled = empty;
  };

  const closePlusMenu = () => {
    if (plusMenu instanceof HTMLElement) {
      plusMenu.hidden = true;
    }
  };

  const showPickerRoot = () => {
    if (pickerRoot instanceof HTMLElement) {
      pickerRoot.hidden = false;
    }

    pickerSections.forEach((section) => {
      if (section instanceof HTMLElement) {
        section.hidden = true;
      }
    });
  };

  const closePicker = () => {
    if (pickerList instanceof HTMLElement) {
      pickerList.hidden = true;
    }

    if (pickerToggle instanceof HTMLButtonElement) {
      pickerToggle.setAttribute("aria-expanded", "false");
    }

    showPickerRoot();
  };

  if (composer instanceof HTMLElement) {
    composer.addEventListener("input", syncComposer);
    composer.addEventListener("blur", syncComposer);
    composer.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
      }
    });
    syncComposer();
  }

  if (plusButton instanceof HTMLButtonElement && plusMenu instanceof HTMLElement) {
    plusButton.addEventListener("click", (event) => {
      event.stopPropagation();
      plusMenu.hidden = !plusMenu.hidden;
      closePicker();
    });
  }

  if (
    picker instanceof HTMLElement &&
    pickerToggle instanceof HTMLButtonElement &&
    pickerList instanceof HTMLElement
  ) {
    pickerToggle.addEventListener("click", (event) => {
      event.stopPropagation();
      const willOpen = pickerList.hidden;
      closePlusMenu();
      pickerList.hidden = !willOpen;
      pickerToggle.setAttribute("aria-expanded", willOpen ? "true" : "false");

      if (willOpen) {
        showPickerRoot();
      }
    });

    picker.querySelectorAll("[data-wiz-picker-enter]").forEach((button) => {
      button.addEventListener("click", () => {
        const key = button.getAttribute("data-wiz-picker-enter");

        if (pickerRoot instanceof HTMLElement) {
          pickerRoot.hidden = true;
        }

        pickerSections.forEach((section) => {
          if (section instanceof HTMLElement) {
            section.hidden = section.getAttribute("data-wiz-picker-section") !== key;
          }
        });
      });
    });

    picker.querySelectorAll("[data-wiz-picker-back]").forEach((button) => {
      button.addEventListener("click", showPickerRoot);
    });
  }

  document.addEventListener("pointerdown", (event) => {
    const target = event.target;

    if (!(target instanceof Node)) {
      return;
    }

    if (plusMenu instanceof HTMLElement && !plusMenu.contains(target) && plusButton !== target) {
      closePlusMenu();
    }

    if (picker instanceof HTMLElement && !picker.contains(target)) {
      closePicker();
    }
  });

  const transcript = wizardDemo.querySelector("[data-wiz-transcript]");
  const hint = wizardDemo.querySelector("[data-wiz-hint]");
  const userTurn = wizardDemo.querySelector("[data-wiz-user-turn]");
  const userTurn2 = wizardDemo.querySelector("[data-wiz-user-turn-2]");
  const working = wizardDemo.querySelector("[data-wiz-working]");
  const assistantTurn = wizardDemo.querySelector("[data-wiz-assistant-turn]");
  const assistantTurn2 = wizardDemo.querySelector("[data-wiz-assistant-turn-2]");
  const emptyLabel = wizardDemo.querySelector("[data-wiz-empty-label]");
  const generating = wizardDemo.querySelector("[data-wiz-generating]");
  const previewStage = wizardDemo.querySelector("[data-wiz-stage]");
  const result = wizardDemo.querySelector("[data-wiz-result]");
  const placedHost = wizardStage?.querySelector("[data-wiz-placed]");
  const reviewsHost = wizardStage?.querySelector("[data-wiz-reviews]");
  const actionsHost = wizardStage?.querySelector("[data-wiz-actions]");
  const uptimeHost = wizardStage?.querySelector("[data-wiz-uptime]");
  const waterAmount = wizardDemo.querySelector("[data-wiz-water-amount]");
  const waterFill = wizardDemo.querySelector("[data-wiz-water-fill]");
  const waterPct = wizardDemo.querySelector("[data-wiz-water-pct]");
  const saveButtons = wizardDemo.querySelectorAll("[data-wiz-save]");
  const restartButton = wizardWrap?.querySelector("[data-wiz-restart]");
  const playhead = wizardStage?.querySelector("[data-wiz-playhead]");
  const playheadFills = playhead ? [...playhead.querySelectorAll("i")] : [];
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const promptText = "a tracker for how much water I drink today";
  const followUpText = "add percentage to value";
  const waterGoalMl = 3000;
  const waterStartMl = 1750;
  let playGeneration = 0;
  let userTookOver = false;
  let playedThrough = false;
  let activeTimers = [];
  let waterMl = waterStartMl;
  let waterShowsPercent = false;

  const setHidden = (node, hidden) => {
    if (node instanceof HTMLElement) {
      node.hidden = hidden;
    }
  };

  const TYPE_MS = 52;

  const resetPlayhead = () => {
    playheadFills.forEach((fill) => {
      fill.style.transition = "none";
      fill.style.width = "0%";
    });
    setHidden(playhead, false);
  };

  /** Grow one segment over `duration` ms. Call `completePlayheadStep` when the phase actually ends so drift from typing jitter does not leave a gap. */
  const fillPlayheadStep = (index, duration) => {
    const fill = playheadFills[index];
    if (!(fill instanceof HTMLElement)) {
      return;
    }

    fill.style.transition = "none";
    fill.style.width = "0%";
    void fill.offsetWidth;
    fill.style.transition = reduceMotion.matches
      ? "none"
      : `width ${Math.max(0, duration)}ms linear`;
    fill.style.width = "100%";
  };

  const completePlayheadStep = (index) => {
    const fill = playheadFills[index];
    if (!(fill instanceof HTMLElement)) {
      return;
    }

    fill.style.transition = "none";
    fill.style.width = "100%";
  };

  const setSavesEnabled = (enabled) => {
    saveButtons.forEach((button) => {
      if (button instanceof HTMLButtonElement) {
        button.disabled = !enabled;
      }
    });
  };

  const formatLiters = (ml) => {
    const liters = ml / 1000;
    return liters.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  };

  const renderWater = ({ fromZero = false } = {}) => {
    if (!(waterAmount instanceof HTMLElement) || !(waterFill instanceof HTMLElement)) {
      return;
    }

    const percent = Math.min(100, (waterMl / waterGoalMl) * 100);
    waterAmount.replaceChildren(document.createTextNode(formatLiters(waterMl)));
    const unit = document.createElement("span");
    unit.textContent = "L";
    waterAmount.append(unit);

    if (waterPct instanceof HTMLElement) {
      waterPct.hidden = !waterShowsPercent;
      waterPct.textContent = `${Math.round(percent)}%`;
    }

    if (fromZero) {
      waterFill.style.setProperty("--p", "0%");
      waterFill.offsetWidth;
    }

    waterFill.style.setProperty("--p", `${percent}%`);
  };

  const wait = (ms, token) =>
    new Promise((resolve) => {
      const timer = window.setTimeout(resolve, ms);
      token.timers.push(timer);
      activeTimers.push(timer);
    });

  const clearTimers = () => {
    activeTimers.forEach((timer) => window.clearTimeout(timer));
    activeTimers = [];
  };

  const clearDeskPosition = (host) => {
    if (!(host instanceof HTMLElement)) {
      return;
    }

    host.classList.remove("is-dragging");
    host.style.left = "";
    host.style.top = "";
    host.style.transform = "";
    host.style.animation = "";
  };

  const unplaceFromDesktop = () => {
    if (wizardStage instanceof HTMLElement) {
      wizardStage.classList.remove("wiz-stage--placed");
    }

    clearDeskPosition(placedHost);
    clearDeskPosition(reviewsHost);
    clearDeskPosition(actionsHost);
    clearDeskPosition(uptimeHost);

    if (
      result instanceof HTMLElement &&
      previewStage instanceof HTMLElement &&
      result.parentElement !== previewStage
    ) {
      previewStage.append(result);
    }
  };

  const placeOnDesktop = () => {
    if (
      !(result instanceof HTMLElement) ||
      !(placedHost instanceof HTMLElement) ||
      !(wizardStage instanceof HTMLElement)
    ) {
      return;
    }

    placedHost.append(result);
    result.hidden = false;
    wizardStage.classList.add("wiz-stage--placed");
  };

  const resetScene = () => {
    if (!(composer instanceof HTMLElement) || !(transcript instanceof HTMLElement)) {
      return;
    }

    composer.textContent = "";
    composer.classList.remove("wiz-composer-editor--typing");
    unplaceFromDesktop();
    transcript.classList.add("wiz-transcript--empty");
    setHidden(hint, false);
    setHidden(userTurn, true);
    setHidden(userTurn2, true);
    setHidden(working, true);
    setHidden(assistantTurn, true);
    setHidden(assistantTurn2, true);
    setHidden(emptyLabel, false);
    setHidden(generating, true);
    setHidden(result, true);
    setSavesEnabled(false);
    waterMl = waterStartMl;
    waterShowsPercent = false;
    renderWater();
    resetPlayhead();
    syncComposer();
  };

  const playConversation = async (token) => {
    if (
      userTookOver ||
      !(composer instanceof HTMLElement) ||
      !(transcript instanceof HTMLElement)
    ) {
      return;
    }

    resetScene();
    fillPlayheadStep(
      0,
      700 +
        promptText.length * TYPE_MS +
        450 +
        5000 +
        2400 +
        followUpText.length * TYPE_MS +
        450 +
        2800,
    );
    await wait(700, token);
    if (!token.alive()) return;

    const typeIntoComposer = async (text) => {
      composer.classList.add("wiz-composer-editor--typing");

      for (let index = 1; index <= text.length; index += 1) {
        if (!token.alive()) return false;
        composer.textContent = text.slice(0, index);
        syncComposer();
        await wait(36 + Math.random() * 32, token);
      }

      if (!token.alive()) return false;
      composer.classList.remove("wiz-composer-editor--typing");
      await wait(450, token);
      return token.alive();
    };

    if (!(await typeIntoComposer(promptText))) return;

    composer.textContent = "";
    transcript.classList.remove("wiz-transcript--empty");
    setHidden(hint, true);
    setHidden(userTurn, false);
    setHidden(working, false);
    setHidden(emptyLabel, true);
    setHidden(generating, false);
    syncComposer();

    await wait(5000, token);
    if (!token.alive()) return;

    setHidden(working, true);
    setHidden(generating, true);
    setHidden(assistantTurn, false);
    waterMl = waterStartMl;
    waterShowsPercent = false;
    if (result instanceof HTMLElement) {
      result.hidden = true;
      void result.offsetWidth;
      result.hidden = false;
    }
    renderWater({ fromZero: true });
    setSavesEnabled(true);

    await wait(2400, token);
    if (!token.alive()) return;

    if (!(await typeIntoComposer(followUpText))) return;

    composer.textContent = "";
    setHidden(userTurn2, false);
    setHidden(working, false);
    syncComposer();

    await wait(2800, token);
    if (!token.alive()) return;

    setHidden(working, true);
    setHidden(assistantTurn2, false);
    waterShowsPercent = true;
    renderWater();
    completePlayheadStep(0);
    setHidden(playhead, true);

    await wait(1100, token);
    if (!token.alive()) return;

    placeOnDesktop();
    playedThrough = true;
    setHidden(restartButton, false);
  };

  const stopPlay = () => {
    playGeneration += 1;
    clearTimers();
  };

  const showRestart = () => {
    setHidden(restartButton, false);
  };

  const startPlay = () => {
    // One autoplay pass only. After that the last frame stays until Restart.
    if (userTookOver || playedThrough) {
      return;
    }

    stopPlay();
    setHidden(restartButton, true);
    const id = playGeneration;
    const token = {
      timers: [],
      alive: () => id === playGeneration && !userTookOver,
    };

    if (reduceMotion.matches) {
      resetScene();
      waterShowsPercent = true;
      renderWater();
      placeOnDesktop();
      playedThrough = true;
      showRestart();
      return;
    }

    void playConversation(token);
  };

  const restartDemo = () => {
    userTookOver = false;
    playedThrough = false;
    setHidden(restartButton, true);
    stopPlay();
    resetScene();
    startPlay();
  };

  if (restartButton instanceof HTMLButtonElement) {
    restartButton.addEventListener("click", restartDemo);
  }

  if (composer instanceof HTMLElement) {
    const takeOver = () => {
      if (userTookOver) {
        return;
      }

      userTookOver = true;
      stopPlay();
      composer.classList.remove("wiz-composer-editor--typing");
      playheadFills.forEach((fill) => {
        fill.style.transition = "none";
      });
      setHidden(playhead, true);
      showRestart();
    };

    composer.addEventListener("pointerdown", takeOver);
    composer.addEventListener("focus", takeOver);
  }

  wizardDemo.querySelectorAll("[data-wiz-add]").forEach((button) => {
    button.addEventListener("click", () => {
      const added = Number(button.getAttribute("data-wiz-add"));
      if (!Number.isFinite(added) || added <= 0) {
        return;
      }

      if (!userTookOver) {
        userTookOver = true;
        stopPlay();
        playheadFills.forEach((fill) => {
          fill.style.transition = "none";
        });
        setHidden(playhead, true);
        showRestart();
      }

      waterMl += added;
      renderWater();
    });
  });

  // Drag a finished widget around the desktop. Buttons keep their own clicks.
  const bindDeskDrag = (host) => {
    if (!(host instanceof HTMLElement) || !(wizardStage instanceof HTMLElement)) {
      return;
    }

    const desktop = wizardStage;
    let drag = null;

    host.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }

      if (event.target instanceof Element && event.target.closest("button")) {
        return;
      }

      const hostRect = host.getBoundingClientRect();
      const deskRect = desktop.getBoundingClientRect();
      host.classList.add("is-dragging");
      host.style.animation = "none";
      host.style.transform = "none";
      host.style.left = `${hostRect.left - deskRect.left}px`;
      host.style.top = `${hostRect.top - deskRect.top}px`;
      drag = {
        offsetX: event.clientX - hostRect.left,
        offsetY: event.clientY - hostRect.top,
        width: hostRect.width,
        height: hostRect.height,
      };
      host.setPointerCapture(event.pointerId);
    });

    host.addEventListener("pointermove", (event) => {
      if (!drag) {
        return;
      }

      const deskRect = desktop.getBoundingClientRect();
      const x = Math.max(0, Math.min(event.clientX - deskRect.left - drag.offsetX, deskRect.width - drag.width));
      const y = Math.max(0, Math.min(event.clientY - deskRect.top - drag.offsetY, deskRect.height - drag.height));
      host.style.left = `${x}px`;
      host.style.top = `${y}px`;
    });

    const endDrag = (event) => {
      if (!drag) {
        return;
      }

      drag = null;
      host.classList.remove("is-dragging");
      if (host.hasPointerCapture(event.pointerId)) {
        host.releasePointerCapture(event.pointerId);
      }
    };

    host.addEventListener("pointerup", endDrag);
    host.addEventListener("pointercancel", endDrag);
  };

  bindDeskDrag(placedHost);
  bindDeskDrag(reviewsHost);
  bindDeskDrag(actionsHost);
  bindDeskDrag(uptimeHost);

  // Paint history ticks from the compact g/o/x strings in the markup.
  const paintUptimeBars = () => {
    wizardStage?.querySelectorAll("[data-up-bars]").forEach((row) => {
      const pattern = row.getAttribute("data-up-bars") ?? "";
      const ticks = [];

      for (const ch of pattern) {
        const tick = document.createElement("i");
        tick.className = ch === "o" ? "warn" : ch === "x" ? "off" : "ok";
        ticks.push(tick);
      }

      row.replaceChildren(...ticks);
    });
  };

  paintUptimeBars();

  const visibility = new IntersectionObserver(
    (entries) => {
      const entry = entries[0];

      if (!entry) {
        return;
      }

      if (entry.isIntersecting) {
        startPlay();
        return;
      }

      stopPlay();
      // Keep the finished (or user-owned) scene; only wipe a run that never completed.
      if (!userTookOver && !playedThrough) {
        resetScene();
      }
    },
    { threshold: 0.45 },
  );

  visibility.observe(wizardStage instanceof HTMLElement ? wizardStage : wizardDemo);
}
