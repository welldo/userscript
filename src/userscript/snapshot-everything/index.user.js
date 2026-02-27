// ==UserScript==
// @name         Snapshot Everything
// @namespace    https://github.com/ZiuChen
// @version      2.0.0
// @description  Take snapshot on any site for any DOM.
// @author       ZiuChen
// @homepage     https://github.com/ZiuChen
// @supportURL   https://github.com/ZiuChen/userscript/issues
// @match        *://*/*
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0Ij48cGF0aCBmaWxsPSJjdXJyZW50Q29sb3IiIGQ9Ik00IDRoM2wyLTJoNmwyIDJoM2EyIDIgMCAwIDEgMiAydjEyYTIgMiAwIDAgMS0yIDJINGEyIDIgMCAwIDEtMi0yVjZhMiAyIDAgMCAxIDItMm04IDNhNSA1IDAgMCAwLTUgNWE1IDUgMCAwIDAgNSA1YTUgNSAwIDAgMCA1LTVhNSA1IDAgMCAwLTUtNW0wIDJhMyAzIDAgMCAxIDMgM2EzIDMgMCAwIDEtMyAzYTMgMyAwIDAgMS0zLTNhMyAzIDAgMCAxIDMtMyIvPjwvc3ZnPg==
// @require      https://cdn.jsdelivr.net/npm/@zumer/snapdom@2/dist/snapdom.js
// @updateURL    https://cdn.jsdelivr.net/gh/ZiuChen/userscript@main/src/userscript/snapshot-everything/index.user.js
// @downloadURL  https://cdn.jsdelivr.net/gh/ZiuChen/userscript@main/src/userscript/snapshot-everything/index.user.js
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @grant        GM_info
// ==/UserScript==

;(() => {
  'use strict'

  const SCRIPT_NAME = GM_info.script.name

  // ─── i18n ──────────────────────────────────────────────────────────────────────

  const MESSAGES = {
    en: {
      menu: 'Take Snapshot',
      snapshot: 'Snapshot',
      preview: 'Preview',
      cancel: 'Cancel',
      download: 'Download',
      close: 'Close',
      noElement: 'No element selected',
      failed: 'Snapshot failed'
    },
    'zh-CN': {
      menu: '截图',
      snapshot: '截图',
      preview: '预览',
      cancel: '取消',
      download: '下载',
      close: '关闭',
      noElement: '未选中元素',
      failed: '截图失败'
    },
    'zh-TW': {
      menu: '截圖',
      snapshot: '截圖',
      preview: '預覽',
      cancel: '取消',
      download: '下載',
      close: '關閉',
      noElement: '未選中元素',
      failed: '截圖失敗'
    }
  }

  const t = (() => {
    const lang = navigator.language || 'en'
    if (MESSAGES[lang]) return MESSAGES[lang]
    if (lang.startsWith('zh')) return MESSAGES['zh-CN']
    return MESSAGES.en
  })()

  // ─── Entry ─────────────────────────────────────────────────────────────────────

  GM_registerMenuCommand(t.menu, async () => {
    try {
      const inspector = new DOMInspector()
      const result = await inspector.pick()
      if (!result) return // cancelled or already handled (preview download)

      const { element, padding } = result
      if (!element) throw new Error(t.noElement)

      const blob = await captureWithPadding(element, padding)
      if (!blob) throw new Error(t.failed)

      downloadBlob(blob, generateFilename())
    } catch (err) {
      GM_notification({ title: SCRIPT_NAME, text: err.message || t.failed, timeout: 3000 })
      console.error(`[${SCRIPT_NAME}]`, err)
    }
  })

  // ─── Helpers ───────────────────────────────────────────────────────────────────

  function generateFilename() {
    const now = new Date()
    const date = now.toISOString().slice(0, 10)
    const time = now.toTimeString().slice(0, 8).replace(/:/g, '-')
    return `SnapshotEverything_${date}_${time}.png`
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob)
    const a = Object.assign(document.createElement('a'), { href: url, download: name })
    document.body.appendChild(a)
    a.click()
    setTimeout(() => {
      URL.revokeObjectURL(url)
      a.remove()
    }, 100)
  }

  function getEffectiveBackground(el) {
    let current = el
    while (current && current !== document.documentElement) {
      const bg = getComputedStyle(current).backgroundColor
      if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') return bg
      current = current.parentElement
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? '#1e1e1e' : '#ffffff'
  }

  async function captureWithPadding(element, padding = 0) {
    const SCALE = 2
    const captured = await snapdom(element, { scale: SCALE, embedFonts: true })

    if (padding <= 0) return captured.toBlob({ type: 'png' })

    const canvas = await captured.toCanvas()
    const pad = Math.round(padding * SCALE)
    const padded = document.createElement('canvas')
    padded.width = canvas.width + pad * 2
    padded.height = canvas.height + pad * 2
    const ctx = padded.getContext('2d')
    ctx.fillStyle = getEffectiveBackground(element)
    ctx.fillRect(0, 0, padded.width, padded.height)
    ctx.drawImage(canvas, pad, pad)

    return new Promise((resolve) => padded.toBlob(resolve, 'image/png'))
  }

  // ─── DOMInspector ──────────────────────────────────────────────────────────────
  //
  // States:
  //   inspecting → selected ⇄ previewing → finish
  //
  //   inspecting : mouse hover highlights elements, click to select
  //   selected   : overlay locked on element, action bar shown,
  //                click to re-select, Alt+wheel to traverse DOM tree,
  //                adjust padding in real time, preview or snapshot
  //   previewing : full-screen modal with captured image (or loading spinner),
  //                download from preview or close back to selected

  const ACCENT = '#4b9bfa'
  const Z = 2147483640

  class DOMInspector {
    #state = 'idle'
    #hovered = null
    #selected = null
    #resolve = null
    #padding = 0

    // UI nodes
    #overlay = null
    #badge = null
    #bar = null
    #paddingInput = null
    #cursorStyle = null
    #globalStyle = null

    // Preview
    #previewOverlay = null
    #previewBlob = null
    #previewGen = 0

    /** Returns Promise<{ element, padding }> or null if cancelled */
    pick() {
      return new Promise((resolve) => {
        this.#resolve = resolve
        this.#buildUI()
        this.#enterInspecting()
      })
    }

    // ── state transitions ────────────────────────────────────────────────────────

    #enterInspecting() {
      this.#state = 'inspecting'
      this.#setCursor(true)
      document.addEventListener('mousemove', this.#onMove, true)
      document.addEventListener('click', this.#onClick, true)
      document.addEventListener('keydown', this.#onKey, true)
      document.addEventListener('scroll', this.#onScroll, { capture: true, passive: true })
    }

    #enterSelected(el) {
      this.#state = 'selected'
      this.#selected = el
      document.removeEventListener('mousemove', this.#onMove, true)
      document.addEventListener('wheel', this.#onWheel, { capture: true, passive: false })

      this.#overlay.style.borderWidth = '2px'
      this.#overlay.style.backgroundColor = `${ACCENT}18`
      this.#highlight(el)
      this.#showBar(el)
    }

    #finish(action) {
      document.removeEventListener('mousemove', this.#onMove, true)
      document.removeEventListener('click', this.#onClick, true)
      document.removeEventListener('keydown', this.#onKey, true)
      document.removeEventListener('wheel', this.#onWheel, true)
      document.removeEventListener('scroll', this.#onScroll, true)

      this.#setCursor(false)
      this.#destroyUI()

      const resolve = this.#resolve
      this.#resolve = null
      if (action === 'snapshot') {
        resolve?.({ element: this.#selected, padding: this.#padding })
      } else {
        resolve?.(null)
      }
    }

    // ── event handlers ───────────────────────────────────────────────────────────

    #onMove = (e) => {
      const el = document.elementFromPoint(e.clientX, e.clientY)
      if (!el || el === this.#hovered || this.#isOwn(el)) return
      this.#hovered = el
      this.#highlight(el)
    }

    #onClick = (e) => {
      // Handle action buttons first (allow default on non-action UI like inputs)
      const actionEl = e.target.closest?.('[data-se-action]')
      if (actionEl) {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
        this.#handleAction(actionEl.dataset.seAction)
        return
      }

      // Allow default behavior on our own UI (inputs, etc.) but stop propagation
      if (e.target.closest?.('[data-se-ui]')) {
        e.stopPropagation()
        e.stopImmediatePropagation()
        return
      }

      // All page element clicks: prevent default
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()

      if (this.#state === 'inspecting') {
        const el = document.elementFromPoint(e.clientX, e.clientY)
        if (el && !this.#isOwn(el)) {
          this.#hovered = el
          this.#enterSelected(el)
        }
      } else if (this.#state === 'selected') {
        const el = this.#elementAt(e.clientX, e.clientY)
        if (el && !this.#isOwn(el)) {
          this.#selected = el
          this.#highlight(el)
          this.#showBar(el)
        }
      }
    }

    #handleAction(action) {
      switch (action) {
        case 'snapshot':
          return this.#finish('snapshot')
        case 'cancel':
          return this.#finish('cancel')
        case 'preview':
          return this.#showPreview()
        case 'preview-download':
          return this.#downloadFromPreview()
        case 'preview-close':
          return this.#hidePreview()
      }
    }

    #onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        if (this.#previewOverlay) {
          this.#hidePreview()
        } else {
          this.#finish('cancel')
        }
      }
    }

    #onWheel = (e) => {
      // Only intercept Alt (Option on macOS) + scroll
      if (!e.altKey) return
      e.preventDefault()
      e.stopPropagation()
      if (!this.#selected) return

      let next = null
      if (e.deltaY < 0) {
        const p = this.#selected.parentElement
        if (p && p.tagName !== 'HTML') next = p
      } else {
        const c = this.#selected.firstElementChild
        if (c && !this.#isOwn(c)) next = c
      }

      if (next) {
        this.#selected = next
        this.#highlight(next)
        this.#showBar(next)
      }
    }

    #onScroll = () => {
      if (this.#state === 'selected' && this.#selected) {
        this.#highlight(this.#selected)
        this.#showBar(this.#selected)
      } else if (this.#state === 'inspecting' && this.#hovered) {
        this.#highlight(this.#hovered)
      }
    }

    #onPaddingInput = (e) => {
      this.#padding = Math.max(0, parseInt(e.target.value) || 0)
      if (this.#selected) this.#highlight(this.#selected)
    }

    // ── UI construction ──────────────────────────────────────────────────────────

    #buildUI() {
      // Inject spinner keyframes
      this.#globalStyle = document.createElement('style')
      this.#globalStyle.textContent = '@keyframes se-spin{to{transform:rotate(360deg)}}'
      document.head.appendChild(this.#globalStyle)

      // Highlight overlay
      this.#overlay = document.createElement('div')
      this.#overlay.setAttribute('data-se-ui', '')
      Object.assign(this.#overlay.style, {
        position: 'fixed',
        pointerEvents: 'none',
        border: `1.5px solid ${ACCENT}`,
        borderRadius: '2px',
        backgroundColor: `${ACCENT}0F`,
        zIndex: Z,
        display: 'none',
        transition: 'left .1s ease-out, top .1s ease-out, width .1s ease-out, height .1s ease-out'
      })

      // Info badge
      this.#badge = document.createElement('div')
      this.#badge.setAttribute('data-se-ui', '')
      Object.assign(this.#badge.style, {
        position: 'fixed',
        pointerEvents: 'none',
        backgroundColor: ACCENT,
        color: '#fff',
        fontSize: '11px',
        lineHeight: '1',
        padding: '3px 6px',
        borderRadius: '3px',
        zIndex: Z + 1,
        display: 'none',
        fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        whiteSpace: 'nowrap',
        maxWidth: '400px',
        overflow: 'hidden',
        textOverflow: 'ellipsis'
      })

      // Action bar
      const BAR_FONT =
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'

      this.#bar = document.createElement('div')
      this.#bar.setAttribute('data-se-ui', '')
      Object.assign(this.#bar.style, {
        position: 'fixed',
        display: 'none',
        alignItems: 'center',
        gap: '6px',
        padding: '5px',
        background: 'rgba(30, 30, 30, 0.88)',
        backdropFilter: 'blur(12px) saturate(180%)',
        WebkitBackdropFilter: 'blur(12px) saturate(180%)',
        borderRadius: '8px',
        boxShadow: '0 2px 16px rgba(0,0,0,.25), 0 0 0 .5px rgba(255,255,255,.1)',
        zIndex: Z + 2,
        pointerEvents: 'auto',
        fontFamily: BAR_FONT,
        transition: 'left .15s ease-out, top .15s ease-out'
      })

      // Padding control
      const padGroup = document.createElement('div')
      padGroup.setAttribute('data-se-ui', '')
      Object.assign(padGroup.style, {
        display: 'flex',
        alignItems: 'center',
        gap: '3px',
        color: 'rgba(255,255,255,.6)',
        fontSize: '12px',
        fontFamily: BAR_FONT,
        marginRight: '2px'
      })

      const padLabel = document.createElement('span')
      padLabel.textContent = 'P'
      Object.assign(padLabel.style, { fontWeight: '500', userSelect: 'none' })

      this.#paddingInput = document.createElement('input')
      this.#paddingInput.type = 'number'
      this.#paddingInput.min = '0'
      this.#paddingInput.max = '200'
      this.#paddingInput.value = '0'
      this.#paddingInput.step = '4'
      Object.assign(this.#paddingInput.style, {
        width: '42px',
        background: 'rgba(255,255,255,.1)',
        border: '1px solid rgba(255,255,255,.18)',
        borderRadius: '4px',
        color: '#fff',
        fontSize: '12px',
        padding: '3px 2px 3px 6px',
        fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        outline: 'none',
        MozAppearance: 'textfield'
      })
      this.#paddingInput.addEventListener('input', this.#onPaddingInput)
      this.#paddingInput.addEventListener('focus', () => {
        this.#paddingInput.style.borderColor = ACCENT
      })
      this.#paddingInput.addEventListener('blur', () => {
        this.#paddingInput.style.borderColor = 'rgba(255,255,255,.18)'
      })

      const padUnit = document.createElement('span')
      padUnit.textContent = 'px'
      Object.assign(padUnit.style, { fontSize: '11px', userSelect: 'none' })

      padGroup.append(padLabel, this.#paddingInput, padUnit)

      // Separator
      const sep = document.createElement('div')
      Object.assign(sep.style, {
        width: '1px',
        height: '18px',
        background: 'rgba(255,255,255,.15)',
        flexShrink: '0'
      })

      // Buttons
      const snapshotBtn = this.#createBtn(t.snapshot, 'snapshot', ACCENT, '#fff')
      const previewBtn = this.#createBtn(
        t.preview,
        'preview',
        'rgba(255,255,255,.12)',
        'rgba(255,255,255,.85)'
      )
      const cancelBtn = this.#createBtn(
        t.cancel,
        'cancel',
        'rgba(255,255,255,.06)',
        'rgba(255,255,255,.55)'
      )

      this.#bar.append(padGroup, sep, snapshotBtn, previewBtn, cancelBtn)

      const root = document.documentElement
      root.append(this.#overlay, this.#badge, this.#bar)
    }

    #createBtn(text, action, bg, color) {
      const btn = document.createElement('button')
      btn.textContent = text
      btn.dataset.seAction = action
      Object.assign(btn.style, {
        padding: '5px 14px',
        border: 'none',
        borderRadius: '5px',
        fontSize: '12px',
        fontWeight: '500',
        lineHeight: '1.4',
        cursor: 'pointer',
        background: bg,
        color: color,
        fontFamily: 'inherit',
        transition: 'opacity .15s',
        whiteSpace: 'nowrap'
      })
      btn.addEventListener('mouseenter', () => (btn.style.opacity = '0.8'))
      btn.addEventListener('mouseleave', () => (btn.style.opacity = '1'))
      return btn
    }

    #destroyUI() {
      this.#overlay?.remove()
      this.#badge?.remove()
      this.#bar?.remove()
      this.#globalStyle?.remove()
      this.#previewOverlay?.remove()
      this.#overlay = this.#badge = this.#bar = this.#globalStyle = this.#previewOverlay = null
    }

    // ── UI updates ───────────────────────────────────────────────────────────────

    #highlight(el) {
      const r = el.getBoundingClientRect()
      const pad = this.#padding

      Object.assign(this.#overlay.style, {
        display: 'block',
        left: `${r.left - pad}px`,
        top: `${r.top - pad}px`,
        width: `${r.width + pad * 2}px`,
        height: `${r.height + pad * 2}px`
      })

      // badge: "div.container  1200 × 800"
      const ident = this.#ident(el)
      const dims = `${Math.round(r.width)} × ${Math.round(r.height)}`
      this.#badge.textContent = `${ident}  ${dims}`

      const BADGE_H = 18
      const GAP = 4
      let bTop = r.top - pad - BADGE_H - GAP
      if (bTop < 0) bTop = r.bottom + pad + GAP

      Object.assign(this.#badge.style, {
        display: 'block',
        left: `${Math.max(0, r.left - pad)}px`,
        top: `${bTop}px`
      })
    }

    #showBar(el) {
      const bar = this.#bar
      bar.style.display = 'flex'

      const barRect = bar.getBoundingClientRect()
      const elRect = el.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight

      const GAP = 8
      const BADGE_SPACE = 24
      const pad = this.#padding

      // Vertical: prefer above element (accounting for padding), fallback below, clamp to viewport
      let top = elRect.top - pad - barRect.height - GAP - BADGE_SPACE
      if (top < 4) top = elRect.bottom + pad + GAP
      top = Math.max(4, Math.min(top, vh - barRect.height - 4))

      // Horizontal: align with element left, clamp to viewport
      let left = elRect.left - pad
      if (left + barRect.width > vw - 8) left = vw - barRect.width - 8
      left = Math.max(8, left)

      bar.style.left = `${left}px`
      bar.style.top = `${top}px`
    }

    // ── Preview ──────────────────────────────────────────────────────────────────

    async #showPreview() {
      const gen = ++this.#previewGen
      this.#previewBlob = null

      // Hide selection UI during preview
      this.#overlay.style.display = 'none'
      this.#badge.style.display = 'none'
      this.#bar.style.display = 'none'

      // Build preview overlay with loading state
      this.#previewOverlay = document.createElement('div')
      this.#previewOverlay.setAttribute('data-se-ui', '')
      Object.assign(this.#previewOverlay.style, {
        position: 'fixed',
        inset: '0',
        background: 'rgba(0, 0, 0, 0.72)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: Z + 10,
        pointerEvents: 'auto'
      })

      // Spinner container
      const loadingWrap = document.createElement('div')
      Object.assign(loadingWrap.style, {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '16px'
      })

      const spinner = document.createElement('div')
      Object.assign(spinner.style, {
        width: '36px',
        height: '36px',
        border: '3px solid rgba(255,255,255,.2)',
        borderTopColor: 'rgba(255,255,255,.8)',
        borderRadius: '50%',
        animation: 'se-spin .8s linear infinite'
      })

      // Cancel button during loading
      const cancelLoading = this.#createBtn(
        t.cancel,
        'preview-close',
        'rgba(255,255,255,.15)',
        'rgba(255,255,255,.8)'
      )

      loadingWrap.append(spinner, cancelLoading)
      this.#previewOverlay.appendChild(loadingWrap)
      document.documentElement.appendChild(this.#previewOverlay)

      // Capture
      try {
        const blob = await captureWithPadding(this.#selected, this.#padding)
        if (this.#previewGen !== gen) return // cancelled during capture
        this.#previewBlob = blob

        // Replace loading with image
        const imgUrl = URL.createObjectURL(blob)
        const img = document.createElement('img')
        img.src = imgUrl
        Object.assign(img.style, {
          maxWidth: '90vw',
          maxHeight: 'calc(100vh - 100px)',
          borderRadius: '8px',
          boxShadow: '0 4px 32px rgba(0,0,0,.4)',
          objectFit: 'contain'
        })

        const btnRow = document.createElement('div')
        Object.assign(btnRow.style, {
          display: 'flex',
          gap: '8px',
          marginTop: '16px'
        })

        const dlBtn = this.#createBtn(t.download, 'preview-download', ACCENT, '#fff')
        const closeBtn = this.#createBtn(
          t.close,
          'preview-close',
          'rgba(255,255,255,.15)',
          'rgba(255,255,255,.8)'
        )
        btnRow.append(dlBtn, closeBtn)

        // Swap content
        this.#previewOverlay.innerHTML = ''
        this.#previewOverlay.append(img, btnRow)
      } catch (err) {
        if (this.#previewGen !== gen) return
        console.error(`[${SCRIPT_NAME}] Preview capture failed:`, err)
        this.#hidePreview()
        GM_notification({ title: SCRIPT_NAME, text: err.message || t.failed, timeout: 3000 })
      }
    }

    #hidePreview() {
      this.#previewGen++
      this.#previewOverlay?.remove()
      this.#previewOverlay = null
      this.#previewBlob = null

      // Restore selected mode UI
      if (this.#selected) {
        this.#highlight(this.#selected)
        this.#showBar(this.#selected)
      }
    }

    #downloadFromPreview() {
      if (this.#previewBlob) {
        downloadBlob(this.#previewBlob, generateFilename())
      }
      this.#previewOverlay?.remove()
      this.#previewOverlay = null
      this.#previewBlob = null
      this.#finish('downloaded')
    }

    // ── utilities ────────────────────────────────────────────────────────────────

    #setCursor(on) {
      if (on) {
        this.#cursorStyle = document.createElement('style')
        this.#cursorStyle.textContent =
          '[data-se-action] { cursor: pointer !important; } *:not([data-se-action]):not(input) { cursor: crosshair !important; }'
        document.head.appendChild(this.#cursorStyle)
      } else {
        this.#cursorStyle?.remove()
        this.#cursorStyle = null
      }
    }

    #isOwn(el) {
      return !!el?.closest?.('[data-se-ui]')
    }

    #elementAt(x, y) {
      const nodes = [this.#overlay, this.#badge, this.#bar, this.#previewOverlay].filter(Boolean)
      const saved = nodes.map((n) => n.style.display)
      nodes.forEach((n) => (n.style.display = 'none'))
      const el = document.elementFromPoint(x, y)
      nodes.forEach((n, i) => (n.style.display = saved[i]))
      return el
    }

    #ident(el) {
      let s = el.tagName.toLowerCase()
      if (el.id) return `${s}#${el.id}`
      if (typeof el.className === 'string' && el.className.trim()) {
        s += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
      }
      return s
    }
  }
})()
