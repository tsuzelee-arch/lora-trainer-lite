/* ============================================
   LoRA Trainer Prep Tool — App Logic
   Multi-Provider: Gemini / Groq / OpenRouter
   ============================================ */

(() => {
  'use strict';

  // ──────────── Provider Config ────────────
  const PROVIDERS = {
    gemini3: {
      name: 'Gemini 2.5 Flash (免費)',
      model: 'gemini-2.5-flash',
      keyHint: '前往 https://aistudio.google.com/apikey 免費申請',
      testEndpoint: (key) =>
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
      buildTestBody: () => ({
        contents: [{ parts: [{ text: 'Hello, reply with OK.' }] }]
      }),
      buildTestHeaders: () => ({ 'Content-Type': 'application/json' }),
      captionEndpoint: (key) =>
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
      buildCaptionBody: (base64OrArray, prompt) => {
        const base64s = Array.isArray(base64OrArray) ? base64OrArray : [base64OrArray];
        const imageParts = base64s.map(b64 => ({ inlineData: { mimeType: 'image/png', data: b64 } }));
        return {
          contents: [{
            parts: [
              ...imageParts,
              { text: prompt }
            ]
          }]
        };
      },
      buildCaptionHeaders: () => ({ 'Content-Type': 'application/json' }),
      parseResponse: (data) => data?.candidates?.[0]?.content?.parts?.[0]?.text || '',
      parseError: (data) => data?.error?.message || 'Unknown error',
    },

    groq: {
      name: 'Groq',
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      keyHint: '前往 https://console.groq.com/keys 免費申請',
      testEndpoint: () => 'https://api.groq.com/openai/v1/chat/completions',
      buildTestBody: () => ({
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        messages: [{ role: 'user', content: 'Hello, reply with OK.' }],
        max_completion_tokens: 10,
      }),
      buildTestHeaders: (key) => ({
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      }),
      captionEndpoint: () => 'https://api.groq.com/openai/v1/chat/completions',
      buildCaptionBody: (base64OrArray, prompt) => {
        const base64s = Array.isArray(base64OrArray) ? base64OrArray : [base64OrArray];
        const imageParts = base64s.map(b64 => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } }));
        return {
          model: 'meta-llama/llama-4-scout-17b-16e-instruct',
          messages: [{
            role: 'user',
            content: [
              ...imageParts,
              { type: 'text', text: prompt }
            ]
          }],
          max_completion_tokens: 512,
        };
      },
      buildCaptionHeaders: (key) => ({
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      }),
      parseResponse: (data) => data?.choices?.[0]?.message?.content || '',
      parseError: (data) => data?.error?.message || 'Unknown error',
    },

  };

  // ──────────── State ────────────
  const state = {
    images: [],
    processing: false,
    refImageBase64: null,
    cancelRequested: false,
    abortController: null,
    mode: 'single', // 'single' or 'sequence'
    isStitching: false,
    stitchSelection: [], // array of indices
  };

  // ──────────── DOM References ────────────
  const $ = (sel) => document.querySelector(sel);
  const dom = {
    // Mode
    workModeRadios:  document.querySelectorAll('input[name="workMode"]'),
    // API
    apiProvider:     $('#apiProvider'),
    apiKey:          $('#apiKey'),
    apiKeyLabel:     $('#apiKeyLabel'),
    btnTestApi:      $('#btnTestApi'),
    apiStatus:       $('#apiStatus'),
    providerHintText: $('#providerHintText'),
    // Config
    resolution:      $('#resolution'),
    mainCaption:     $('#mainCaption'),
    captionFormat:   $('#captionFormat'),
    subjectType:     $('#subjectType'),
    captionPrompt:   $('#captionPrompt'),
    overwriteCaptions:$('#overwriteCaptions'),
    captionFormatGroup: $('#captionFormatGroup'),
    formatHint:      $('#formatHint'),
    subjectTypeGroup: $('#subjectTypeGroup'),
    sequenceSubjectGroup: $('#sequenceSubjectGroup'),
    sequenceSubject: $('#sequenceSubject'),
    // Subject Ref Settings
    subjectRefSection: $('#subjectRefSection'),
    refDropzone:      $('#refDropzone'),
    refImageInput:    $('#refImageInput'),
    refPreviewWrapper: $('#refPreviewWrapper'),
    refImagePreview:  $('#refImagePreview'),
    btnRemoveRef:     $('#btnRemoveRef'),
    btnDetectFeatures: $('#btnDetectFeatures'),
    excludeFeatures:  $('#excludeFeatures'),
    // Upload
    dropzone:        $('#dropzone'),
    fileInput:       $('#fileInput'),
    // Progress
    progressContainer: $('#progressContainer'),
    progressText:    $('#progressText'),
    progressPercent: $('#progressPercent'),
    progressFill:    $('#progressFill'),
    // Gallery
    gallery:         $('#gallery'),
    imageCount:      $('#imageCount'),
    // Actions
    btnProcess:      $('#btnProcess'),
    btnStop:         $('#btnStop'),
    btnExport:       $('#btnExport'),
    btnConfirmStitch:$('#btnConfirmStitch'),
    btnCancelStitch: $('#btnCancelStitch'),
    
    btnClear:        $('#btnClear'),
    // Toast
    toastContainer:  $('#toastContainer'),
  };

  // ──────────── Storage (Save Config) ────────────
  function loadConfig() {
    const savedProvider = localStorage.getItem('loraPrepProvider');
    const savedRes = localStorage.getItem('loraPrepRes');
    const savedFormat = localStorage.getItem('loraPrepFormat');
    const savedType = localStorage.getItem('loraPrepType');
    const savedExcludes = localStorage.getItem('loraPrepExcludes');
    const savedSeqSub = localStorage.getItem('loraPrepSeqSub');

    if (savedProvider && PROVIDERS[savedProvider]) {
      dom.apiProvider.value = savedProvider;
    }
    if (savedRes) dom.resolution.value = savedRes;
    if (savedFormat) dom.captionFormat.value = savedFormat;
    if (savedType) dom.subjectType.value = savedType;
    if (savedExcludes) dom.excludeFeatures.value = savedExcludes;
    if (savedSeqSub) dom.sequenceSubject.value = savedSeqSub;
  }

  function saveConfig() {
    const provider = dom.apiProvider.value;
    localStorage.setItem('loraPrepProvider', provider);
    localStorage.setItem(`loraPrepKey_${provider}`, dom.apiKey.value.trim());
    localStorage.setItem('loraPrepRes', dom.resolution.value);
    localStorage.setItem('loraPrepFormat', dom.captionFormat.value);
    localStorage.setItem('loraPrepType', dom.subjectType.value);
    localStorage.setItem('loraPrepExcludes', dom.excludeFeatures.value.trim());
    localStorage.setItem('loraPrepSeqSub', dom.sequenceSubject.value.trim());
  }

  // ──────────── Helper: get current provider ────────────
  function getProvider() {
    return PROVIDERS[dom.apiProvider.value] || PROVIDERS.gemini3;
  }

  // ──────────── Toast Notifications ────────────
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icons = { success: '✅', error: '❌', info: 'ℹ️' };
    toast.innerHTML = `<span>${icons[type] || ''}</span><span>${message}</span>`;
    dom.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(40px)';
      toast.style.transition = 'all 0.3s ease-in';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // ──────────── Provider Change UI ────────────
  function onProviderChange() {
    const providerKey = dom.apiProvider.value;
    const provider = getProvider();
    
    const savedKey = localStorage.getItem(`loraPrepKey_${providerKey}`);
    dom.apiKey.value = savedKey || '';

    dom.apiKeyLabel.textContent = `${provider.name} API Key`;
    dom.apiKey.placeholder = `輸入您的 ${provider.name} API Key...`;
    dom.apiKey.type = 'password';
    dom.providerHintText.textContent = provider.keyHint;
    dom.apiStatus.innerHTML = '';
    saveConfig();
  }

  // ──────────── API Connection Test ────────────
  async function testApiConnection() {
    const key = dom.apiKey.value.trim();
    saveConfig(); // Save before test
    if (!key) {
      showToast('請先輸入 API Key', 'error');
      return;
    }

    const provider = getProvider();
    dom.btnTestApi.disabled = true;
    dom.apiStatus.innerHTML = '<span class="status-badge loading"><span class="dot"></span>測試中...</span>';

    try {
      const url = provider.testEndpoint(key);
      const resp = await fetch(url, {
        method: 'POST',
        headers: provider.buildTestHeaders(key),
        body: JSON.stringify(provider.buildTestBody(key)),
      });

      if (resp.ok) {
        dom.apiStatus.innerHTML = `<span class="status-badge success"><span class="dot"></span>${provider.name} 連線成功 ✓</span>`;
        showToast(`${provider.name} API 連線成功`, 'success');
      } else {
        const errData = await resp.json().catch(() => ({}));
        const msg = provider.parseError(errData) || `HTTP ${resp.status}`;
        dom.apiStatus.innerHTML = `<span class="status-badge error"><span class="dot"></span>連線失敗：${msg}</span>`;
        showToast('API 連線失敗：' + msg, 'error');
      }
    } catch (err) {
      dom.apiStatus.innerHTML = `<span class="status-badge error"><span class="dot"></span>網路錯誤</span>`;
      showToast('網路錯誤：' + err.message, 'error');
    } finally {
      dom.btnTestApi.disabled = false;
    }
  }

  // ──────────── Image Loading ────────────
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  // ──────────── File Upload / Import ────────────
  async function handleFiles(files) {
    const fileArray = Array.from(files);
    
    showProgress(true);
    updateProgress('正在讀取檔案...', 10);

    const zipFiles = fileArray.filter(f => f.name.endsWith('.zip'));
    let imageFiles = fileArray.filter(f => f.type.startsWith('image/'));
    const textMap = new Map();

    // 1. Read loose txt files
    const textFiles = fileArray.filter(f => f.name.endsWith('.txt'));
    for (const txtFile of textFiles) {
      if (txtFile.name === 'captions_all.txt' || txtFile.name === 'captions.txt') continue;
      const baseName = txtFile.name.replace(/\.[^/.]+$/, "");
      textMap.set(baseName, await txtFile.text());
    }

    // 2. Read ZIP files
    for (const zipFile of zipFiles) {
      try {
        const zip = await JSZip.loadAsync(zipFile);
        
        for (const [filename, fileData] of Object.entries(zip.files)) {
          if (fileData.dir) continue;
          const baseName = filename.split('/').pop().replace(/\.[^/.]+$/, "");
          
          if (filename.endsWith('.txt') && !filename.includes('captions_all') && !filename.includes('captions.txt')) {
             const text = await fileData.async("text");
             textMap.set(baseName, text);
          } else {
             const lower = filename.toLowerCase();
             if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.webp')) {
               const blob = await fileData.async("blob");
               let ext = lower.split('.').pop();
               if (ext === 'jpg') ext = 'jpeg';
               const fileObj = new File([blob], filename.split('/').pop(), { type: `image/${ext}` });
               imageFiles.push(fileObj);
             }
          }
        }
      } catch (err) {
        console.error(err);
        showToast(`讀取 ZIP (${zipFile.name}) 失敗`, 'error');
      }
    }

    if (imageFiles.length === 0) {
      showToast('未偵測到圖片檔案或 ZIP', 'error');
      showProgress(false);
      return;
    }

    for (let i = 0; i < imageFiles.length; i++) {
      const file = imageFiles[i];
      updateProgress(`載入圖片 ${i + 1}/${imageFiles.length}...`, 10 + (i / imageFiles.length) * 90);
      
      const id = Date.now() + Math.random().toString(36).slice(2, 8);
      const url = URL.createObjectURL(file);
      const img = await loadImage(url);
      
      const baseName = file.name.replace(/\.[^/.]+$/, "");
      const importedCaption = textMap.get(baseName) || '';

      const minSide = Math.min(img.naturalWidth, img.naturalHeight);

      state.images.push({
        id,
        type: 'single',
        caption: importedCaption,
        status: importedCaption ? 'captioned' : 'pending',
        selected: true,
        bgColor: '#FFFFFF',
        images: [{
          id: id + '_img',
          file,
          imgElement: img,
          originalUrl: url,
          scale: 1,
          offsetX: 0,
          offsetY: 0,
          croppedBlob: null,
        }]
      });
    }

    updateProgress('載入完成', 100);
    setTimeout(() => showProgress(false), 500);

    renderGallery();
    updateActionButtons();
    showToast(`已載入 ${imageFiles.length} 張圖片`, 'success');
  }

  // ──────────── Draw Canvas ────────────
  function drawCanvas(ctx, subImg, drawSize, bgColor = '#FFFFFF') {
    const img = subImg.imgElement;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const minSide = Math.min(w, h);

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, drawSize, drawSize);

    const zoom = subImg.scale;
    const srcSizeX = minSide / zoom;
    const srcSizeY = minSide / zoom;

    const cx = w / 2;
    const cy = h / 2;

    const pxOffsetX = subImg.offsetX * (minSide / drawSize);
    const pxOffsetY = subImg.offsetY * (minSide / drawSize);

    let sx = cx - (srcSizeX / 2) - pxOffsetX;
    let sy = cy - (srcSizeY / 2) - pxOffsetY;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, srcSizeX, srcSizeY, 0, 0, drawSize, drawSize);
  }

  // ──────────── Render & Bind Canvas ────────────
  function renderGallery() {
    if (state.images.length === 0) {
      dom.gallery.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📭</div>
          <p>尚未上傳任何圖片</p>
        </div>`;
      dom.imageCount.textContent = '0 張圖片';
      return;
    }

    dom.imageCount.textContent = `${state.images.length} 張圖片`;

    dom.gallery.innerHTML = state.images.map((entry, i) => {
      const idx = i + 1;
      const statusMap = {
        pending: '⏳ 等待處理',
        captioned: '✅ 已完成',
        error: '❌ 發生錯誤',
      };
      
      const checkedAttr = entry.selected ? 'checked' : '';
      const opacity = entry.selected ? '1' : '0.5';

      const isStitchingClass = state.isStitching ? 'stitching' : '';
      const stitchIndex = state.stitchSelection.indexOf(i);
      const isStitchedSelectedClass = stitchIndex !== -1 ? 'stitched-selected' : '';
      const badgeHtml = stitchIndex !== -1 ? `<div class="stitch-badge">${stitchIndex + 1}</div>` : '';

      return `
        <div class="gallery-card ${isStitchingClass} ${isStitchedSelectedClass}" data-index="${i}" style="opacity: ${opacity}; transition: opacity 0.2s;">
          ${badgeHtml}
          <div class="card-header" style="display:flex; justify-content:space-between; align-items:center; padding: 8px; background: rgba(0,0,0,0.2); border-bottom: 1px solid rgba(255,255,255,0.05);">
             <div style="display:flex; align-items:center; gap:10px;">
               <label style="display:flex; align-items:center; gap:5px; cursor:pointer; margin:0;">
                  <input type="checkbox" class="card-select" ${checkedAttr} style="width:auto; margin:0; accent-color:var(--primary);" />
                  <span style="font-size:0.85rem;">啟用處理</span>
               </label>
               <div class="color-picker-group" style="transform: scale(0.8); transform-origin: left center;">
                 <select class="card-bg-select">
                   <option value="#FFFFFF" ${entry.bgColor==='#FFFFFF'?'selected':''}>白</option>
                   <option value="#000000" ${entry.bgColor==='#000000'?'selected':''}>黑</option>
                   <option value="#00FF00" ${entry.bgColor==='#00FF00'?'selected':''}>綠</option>
                   <option value="#0000FF" ${entry.bgColor==='#0000FF'?'selected':''}>藍</option>
                   <option value="custom" ${!['#FFFFFF','#000000','#00FF00','#0000FF'].includes(entry.bgColor)?'selected':''}>自訂</option>
                 </select>
                 <input type="color" class="card-bg-picker" value="${entry.bgColor || '#FFFFFF'}" title="選擇自訂顏色" />
                 <button class="btn-secondary btn-icon card-bg-eyedropper" title="吸取顏色" style="padding:4px; height:auto; border-radius:4px; ${!window.EyeDropper ? 'display:none;' : ''}">💉</button>
               </div>
             </div>
             <div style="display:flex; gap:8px;">
               ${entry.type === 'single' && state.mode === 'sequence' && !state.isStitching ? `<button class="btn-enter-stitch" title="進入拼接模式" style="background:transparent; border:none; padding:4px; font-size:1.1rem; cursor:pointer; color:#a855f7; transition:transform 0.2s;">🔗</button>` : ''}
               ${entry.type === 'group' ? `<button class="btn-split" title="拆分小組" style="background:transparent; border:none; padding:4px; display:inline-flex; align-items:center; justify-content:center; cursor:pointer; color:#06b6d4; transition:transform 0.2s;"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none;"><rect width="8" height="6" x="5" y="4" rx="1"/><rect width="8" height="6" x="11" y="14" rx="1"/></svg></button>` : ''}
               <button class="btn-delete" title="刪除此項目" style="background:transparent; border:none; padding:4px; font-size:1.1rem; cursor:pointer; color:#ff4d4d; transition:transform 0.2s;">🗑️</button>
             </div>
          </div>
          <div class="card-images">
            ${entry.images.map((img, subIdx) => `
              <div class="sub-image-wrapper">
                <canvas class="crop-canvas" data-sub="${subIdx}"></canvas>
                <div class="zoom-controls">
                  <span class="zoom-icon">🔍</span>
                  <input type="range" class="zoom-slider" data-sub="${subIdx}" min="0.1" max="3" step="0.05" value="${img.scale}">
                </div>
                ${entry.type === 'group' ? `<div style="position:absolute; top:4px; left:4px; background:rgba(0,0,0,0.6); padding:2px 6px; border-radius:4px; font-size:0.75rem; z-index:10;">${subIdx === 0 ? 'Start' : (subIdx === entry.images.length - 1 ? 'End' : 'Mid ' + subIdx)}</div>` : ''}
              </div>
            `).join('')}
          </div>
          <div class="card-body">
            <div class="card-index">#${idx} ${entry.type === 'group' ? '(Group)' : ''}</div>
            <textarea class="card-caption" placeholder="Caption 將在處理後生成...">${entry.caption}</textarea>
            <div class="card-status">${statusMap[entry.status] || entry.status}</div>
          </div>
        </div>`;
    }).join('');

    // Bind canvas interactions
    dom.gallery.querySelectorAll('.gallery-card').forEach(card => {
      const i = parseInt(card.dataset.index, 10);
      const entry = state.images[i];
      const captionTa = card.querySelector('.card-caption');
      const bgSelect = card.querySelector('.card-bg-select');
      const bgPicker = card.querySelector('.card-bg-picker');
      const btnEye = card.querySelector('.card-bg-eyedropper');

      // Stitching Logic
      if (state.isStitching) {
        card.addEventListener('click', (e) => {
          if (['INPUT', 'BUTTON', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
          const selIdx = state.stitchSelection.indexOf(i);
          if (selIdx === -1) {
             state.stitchSelection.push(i);
          } else {
             state.stitchSelection.splice(selIdx, 1);
          }
          renderGallery();
          updateActionButtons();
        });
      }
      
      const redrawCard = () => {
         card.querySelectorAll('.sub-image-wrapper').forEach(wrapper => {
            const canvas = wrapper.querySelector('.crop-canvas');
            const subIdx = parseInt(canvas.dataset.sub, 10);
            if (canvas && entry && entry.images[subIdx]) {
               drawCanvas(canvas.getContext('2d'), entry.images[subIdx], canvas.width, entry.bgColor);
            }
         });
      };

      if (bgSelect) {
         bgSelect.addEventListener('change', (e) => {
            if (e.target.value !== 'custom') {
               entry.bgColor = e.target.value;
               if (bgPicker) bgPicker.value = e.target.value;
            } else if (bgPicker) {
               entry.bgColor = bgPicker.value;
            }
            redrawCard();
         });
      }
      
      if (bgPicker) {
         bgPicker.addEventListener('input', (e) => {
            entry.bgColor = e.target.value;
            if (bgSelect) bgSelect.value = 'custom';
            redrawCard();
         });
      }
      
      if (btnEye && window.EyeDropper) {
         btnEye.addEventListener('click', async () => {
            try {
               const eyeDropper = new window.EyeDropper();
               const result = await eyeDropper.open();
               entry.bgColor = result.sRGBHex;
               if (bgPicker) bgPicker.value = result.sRGBHex;
               if (bgSelect) bgSelect.value = 'custom';
               redrawCard();
            } catch (err) {}
         });
      }

      card.querySelectorAll('.sub-image-wrapper').forEach(wrapper => {
         const canvas = wrapper.querySelector('.crop-canvas');
         const subIdx = parseInt(canvas.dataset.sub, 10);
         const subImg = entry.images[subIdx];
         const ctx = canvas.getContext('2d');
         const slider = wrapper.querySelector('.zoom-slider');

         canvas.width = 400;
         canvas.height = 400;
         drawCanvas(ctx, subImg, canvas.width, entry.bgColor);

         let isDragging = false;
         let startX, startY;

         const onMove = (e) => {
           if (!isDragging) return;
           const dx = e.clientX || e.touches?.[0]?.clientX;
           const dy = e.clientY || e.touches?.[0]?.clientY;
           const diffX = dx - startX;
           const diffY = dy - startY;
           
           subImg.offsetX += diffX * (canvas.width / canvas.clientWidth);
           subImg.offsetY += diffY * (canvas.height / canvas.clientHeight);

           startX = dx;
           startY = dy;
           drawCanvas(ctx, subImg, canvas.width, entry.bgColor);
         };

         const onStart = (e) => {
           isDragging = true;
           startX = e.clientX || e.touches?.[0]?.clientX;
           startY = e.clientY || e.touches?.[0]?.clientY;
           window.addEventListener('mousemove', onMove);
           window.addEventListener('touchmove', onMove);
           window.addEventListener('mouseup', onEnd);
           window.addEventListener('touchend', onEnd);
         };

         const onEnd = () => {
           isDragging = false;
           window.removeEventListener('mousemove', onMove);
           window.removeEventListener('touchmove', onMove);
           window.removeEventListener('mouseup', onEnd);
           window.removeEventListener('touchend', onEnd);
         };

         canvas.addEventListener('mousedown', onStart);
         canvas.addEventListener('touchstart', onStart, {passive: true});

         canvas.addEventListener('wheel', (e) => {
           e.preventDefault();
           const delta = e.deltaY > 0 ? -0.1 : 0.1;
           let newScale = subImg.scale + delta;
           newScale = Math.max(0.1, Math.min(newScale, 3));
           subImg.scale = newScale;
           slider.value = newScale;
           drawCanvas(ctx, subImg, canvas.width, entry.bgColor);
         });

         slider.addEventListener('input', (e) => {
           subImg.scale = parseFloat(e.target.value);
           drawCanvas(ctx, subImg, canvas.width, entry.bgColor);
         });
      });

      const btnEnterStitch = card.querySelector('.btn-enter-stitch');
      if (btnEnterStitch) {
         btnEnterStitch.addEventListener('click', () => {
            state.isStitching = true;
            state.stitchSelection = [i]; // Initialize with clicked item
            dom.btnConfirmStitch.style.display = 'inline-block';
            dom.btnCancelStitch.style.display = 'inline-block';
            renderGallery();
            updateActionButtons();
         });
      }

      card.querySelector('.btn-delete').addEventListener('click', () => {
         if (confirm('確定要刪除此項目嗎？')) {
            state.images.splice(i, 1);
            renderGallery();
            updateActionButtons();
         }
      });
      
      const btnSplit = card.querySelector('.btn-split');
      if (btnSplit) {
         btnSplit.addEventListener('click', () => {
            const newItems = entry.images.map(img => ({
               id: Date.now() + Math.random().toString(36).slice(2, 8),
               type: 'single',
               caption: entry.caption,
               status: entry.status,
               selected: entry.selected,
               bgColor: entry.bgColor,
               images: [img]
            }));
            state.images.splice(i, 1, ...newItems);
            renderGallery();
            updateActionButtons();
         });
      }
      
      card.querySelector('.card-select').addEventListener('change', (e) => {
         entry.selected = e.target.checked;
         card.style.opacity = entry.selected ? '1' : '0.5';
         updateActionButtons();
      });

      const enableDrag = () => card.setAttribute('draggable', 'true');
      const disableDrag = () => card.setAttribute('draggable', 'false');
      
      card.querySelector('.card-header').addEventListener('mouseenter', enableDrag);
      card.querySelector('.card-body').addEventListener('mouseenter', enableDrag);
      card.querySelector('.card-images').addEventListener('mouseenter', disableDrag);

      card.querySelector('.card-header').addEventListener('touchstart', enableDrag, {passive: true});
      card.querySelector('.card-body').addEventListener('touchstart', enableDrag, {passive: true});
      card.querySelector('.card-images').addEventListener('touchstart', disableDrag, {passive: true});

      card.addEventListener('dragstart', (e) => {
         e.dataTransfer.setData('text/plain', i);
         e.dataTransfer.effectAllowed = 'move';
         setTimeout(() => card.classList.add('dragging'), 0);
      });
      card.addEventListener('dragend', () => {
         card.classList.remove('dragging');
      });
      card.addEventListener('dragover', (e) => {
         e.preventDefault();
         e.dataTransfer.dropEffect = 'move';
         card.classList.add('drag-over');
      });
      card.addEventListener('dragleave', () => {
         card.classList.remove('drag-over');
      });
      card.addEventListener('drop', (e) => {
         e.preventDefault();
         card.classList.remove('drag-over');
         const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
         const toIndex = i;
         if (!isNaN(fromIndex) && fromIndex !== toIndex) {
            const [movedItem] = state.images.splice(fromIndex, 1);
            state.images.splice(toIndex, 0, movedItem);
            renderGallery();
         }
      });
      captionTa.addEventListener('input', (e) => {
        entry.caption = e.target.value;
      });
    });

  }

  // (Removed global bgColor listeners)

  dom.resolution.addEventListener('change', saveConfig);
  dom.apiKey.addEventListener('input', saveConfig);

  // ──────────── Helper: Fetch with retry on 429 ────────────
  async function fetchWithRetry(url, options, maxRetries = 5, onRetry = null) {
    const signal = options?.signal;
    const abortableSleep = (ms) => new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    });

    let attempt = 0;
    while (true) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      try {
        const resp = await fetch(url, options);
        if (resp.ok) return resp;

        if (resp.status === 429 && attempt < maxRetries) {
          attempt++;
          let waitMs = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
          const retryAfter = resp.headers.get('retry-after');
          if (retryAfter) {
            const parsed = parseFloat(retryAfter);
            if (!isNaN(parsed)) waitMs = parsed * 1000;
          }
          waitMs += 500;
          if (onRetry) onRetry(waitMs / 1000, attempt);
          await abortableSleep(waitMs);
          continue;
        }
        return resp;
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        if (attempt < maxRetries) {
          attempt++;
          const waitMs = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
          if (onRetry) onRetry(waitMs / 1000, attempt);
          await abortableSleep(waitMs);
          continue;
        }
        throw err;
      }
    }
  }

  // ──────────── Generate Crop Blob & Caption ────────────
  async function generateFinalCrop(targetImg, targetSize, bgColor = '#FFFFFF') {
    const canvas = document.createElement('canvas');
    canvas.width = targetSize;
    canvas.height = targetSize;
    const ctx = canvas.getContext('2d');
    drawCanvas(ctx, targetImg, targetSize, bgColor);
    
    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        targetImg.croppedBlob = blob;
        resolve(blob);
      }, 'image/png');
    });
  }

  async function generateCaption(entry, targetImgs, currentPercent) {
    const key = dom.apiKey.value.trim();
    if (!key) throw new Error('API Key 未填入');

    const provider = getProvider();
    
    // Convert all target images to base64
    const base64s = [];
    for (const img of targetImgs) {
       const arrayBuffer = await img.croppedBlob.arrayBuffer();
       const b64 = btoa(new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), ''));
       base64s.push(b64);
    }

    // Build the dynamic prompt based on user settings
    const customPrompt = dom.captionPrompt.value.trim();
    const format = state.mode === 'sequence' ? 'natural' : dom.captionFormat.value;
    const sType = dom.subjectType.value;
    const trigger = dom.mainCaption.value.trim();
    const excludesText = dom.excludeFeatures.value.trim();
    const sequenceSubject = dom.sequenceSubject.value.trim();

    let formatInstruction = '';
    if (format === 'tags') {
      formatInstruction = 'Format the output STRICTLY as a comma-separated list of tags/phrases (e.g. 1girl, sweater, street, standing). Do NOT write full sentences, prefixes, markdown code blocks, or conversational explanations.';
    } else {
      formatInstruction = `Format the output STRICTLY as a descriptive, natural language paragraph/sentences.
CRITICAL: Do NOT use any introductory or subjective referencing phrases. Do NOT start sentences with phrases like "The image shows", "The image displays", "The picture depicts", "This image features", "In this image", "Here we see", "Shown here is", "Depicted in", or any similar meta-references to the image itself.
Instead, describe the scene DIRECTLY as if narrating what exists, e.g. "A woman stands in a sunlit garden..." rather than "The image shows a woman standing in a sunlit garden...".
Do NOT write tags, prefixes, markdown code blocks, or conversational explanations.`;
    }

    let finalPrompt = '';

    if (state.mode === 'sequence' && entry.type === 'group') {
      finalPrompt = `You are an AI generating captions for a machine learning model.
You are provided with TWO images in sequential order: Image 1 (Starting state) and Image 2 (Final state).
The user's defined context for this transformation is: "${sequenceSubject}".
Your task is to describe the exact TRANSFORMATION or actions that happen to Image 1 to make it look like Image 2.

${formatInstruction}

General description instructions:
${customPrompt || 'Describe how the starting state transforms into the final state.'}`;
    } else {
      let subjectInstruction = '';
      if (sType !== 'none' && trigger) {
        subjectInstruction = `CRITICAL REQUIREMENT: This is a training image for a ${sType} represented by the trigger word "${trigger}".
Instead of describing the detailed features/characteristics of the ${sType} itself, you MUST use the trigger word "${trigger}" to represent it.
For example, if you see the ${sType}, do NOT describe its visual features, just refer to it as "${trigger}".`;
        
        if (excludesText) {
          subjectInstruction += `\nSpecifically, you MUST NOT describe the following features of the ${sType} in your description: ${excludesText}. Replace these features and references to the subject entirely with "${trigger}".`;
        }
      }

      finalPrompt = `You are a helper captioning training data for a machine learning model.
Please analyze the uploaded image and describe it according to these instructions:
${formatInstruction}

${subjectInstruction}

General description instructions:
${customPrompt || 'Describe the main subject, clothing, pose, background, lighting, and mood.'}`;
    }

    const url = provider.captionEndpoint(key);
    const resp = await fetchWithRetry(
      url,
      {
        method: 'POST',
        headers: provider.buildCaptionHeaders(key),
        body: JSON.stringify(provider.buildCaptionBody(base64s, finalPrompt, key)),
        signal: state.abortController?.signal,
      },
      5,
      (waitSeconds, attempt) => {
        showToast(`觸發 API 速率限制，等待 ${waitSeconds.toFixed(1)} 秒...`, 'info');
        updateProgress(`速率限制中... 等待 ${waitSeconds.toFixed(1)} 秒 (重試 ${attempt}/5)`, currentPercent);
      }
    );

    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({}));
      throw new Error(provider.parseError(errData) || `HTTP ${resp.status}`);
    }

    const data = await resp.json();
    const text = provider.parseResponse(data);
    let cleaned = text.replace(/```[a-z]*\n?/g, '').replace(/\n+/g, ', ').trim();

    // Strip subjective/meta image references from natural language output
    if (format !== 'tags') {
      cleaned = cleaned
        .replace(/^(the\s+(image|picture|photo|photograph|illustration|artwork|scene)\s+(shows?|displays?|depicts?|features?|presents?|captures?|portrays?|illustrates?|reveals?)\s*)/gi, '')
        .replace(/^(this\s+(image|picture|photo|photograph|illustration|artwork|scene)\s+(shows?|displays?|depicts?|features?|presents?|captures?|portrays?|illustrates?|reveals?)\s*)/gi, '')
        .replace(/^(in\s+this\s+(image|picture|photo|photograph),?\s*)/gi, '')
        .replace(/^(here\s+(we\s+see|is|are)\s*)/gi, '')
        .replace(/^(shown\s+here\s+is\s*)/gi, '')
        .replace(/^(depicted\s+(here|in\s+the\s+(image|picture))\s+(is|are)\s*)/gi, '')
        .replace(/^(we\s+(can\s+)?see\s*)/gi, '')
        .trim();
      // Capitalize the first letter after stripping
      if (cleaned.length > 0) {
        cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
      }
    }

    // Perform post-processing cleanup
    if (sType !== 'none' && trigger) {
      if (format === 'tags') {
        let tags = cleaned.split(',').map(t => t.trim()).filter(Boolean);
        const excludeList = excludesText.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
        
        tags = tags.filter(tag => {
          const lowerTag = tag.toLowerCase();
          // Remove if tag contains the trigger word (since we will prepend it if needed)
          if (lowerTag.includes(trigger.toLowerCase())) return false;
          // Remove if tag is in or highly similar to any of the excluded features
          for (const ext of excludeList) {
            if (lowerTag.includes(ext) || ext.includes(lowerTag)) {
              return false;
            }
          }
          return true;
        });
        cleaned = tags.join(', ');
      } else {
        const excludeList = excludesText.split(',').map(e => e.trim()).filter(Boolean);
        excludeList.forEach(feature => {
          const regex = new RegExp(`\\b${feature}\\b`, 'gi');
          cleaned = cleaned.replace(regex, '');
        });
        cleaned = cleaned.replace(/\s+/g, ' ').replace(/,\s*,/g, ',').replace(/\.\s*\./g, '.').trim();
      }
    }

    // Prepend trigger word if not already present in the cleaned caption
    if (trigger) {
      // In sequence mode, we ALWAYS prepend the trigger word for groups since it represents the action
      if (state.mode === 'sequence' && entry.type === 'group') {
        entry.caption = `${trigger}, ${cleaned}`;
      } else {
        const lowerCleaned = cleaned.toLowerCase();
        const lowerTrigger = trigger.toLowerCase();
        if (!lowerCleaned.includes(lowerTrigger)) {
          entry.caption = `${trigger}, ${cleaned}`;
        } else {
          entry.caption = cleaned;
        }
      }
    } else {
      entry.caption = cleaned;
    }
    
    entry.status = 'captioned';
  }

  // ──────────── Subject Feature Detection ────────────
  async function detectSubjectFeatures() {
    const key = dom.apiKey.value.trim();
    if (!key) {
      showToast('請先輸入 API Key 以進行偵測', 'error');
      return;
    }
    if (!state.refImageBase64) {
      showToast('請先上傳主體參考圖', 'error');
      return;
    }
    const sType = dom.subjectType.value;
    if (sType === 'none') {
      showToast('請先選擇訓練主體類型', 'error');
      return;
    }

    const provider = getProvider();
    dom.btnDetectFeatures.disabled = true;
    const originalText = dom.btnDetectFeatures.textContent;
    dom.btnDetectFeatures.textContent = '⏳ 偵測中...';

    let prompt = '';
    if (sType === 'character') {
      prompt = 'Describe this character in detail. List only their key identifying visual features (e.g. hair color/style, eye color, clothing style, facial features, key accessories). Output strictly as a comma-separated list of tags/phrases in English, and DO NOT include any conversational introduction, prefix, or markdown formatting.';
    } else if (sType === 'style') {
      prompt = 'Describe the artistic style of this image. List only its key defining stylistic elements (e.g. color scheme, brush strokes, texture, medium, lighting style). Output strictly as a comma-separated list of tags/phrases in English, and DO NOT include any conversational introduction, prefix, or markdown formatting.';
    } else if (sType === 'clothing') {
      prompt = 'Describe the clothing/garment shown in this image. List only its key defining elements (e.g. color, fabric, pattern, cut, unique details). Output strictly as a comma-separated list of tags/phrases in English, and DO NOT include any conversational introduction, prefix, or markdown formatting.';
    } else if (sType === 'object') {
      prompt = 'Describe the main object shown in this image. List only its key physical identifying features (e.g. shape, material, color, specific details/components). Output strictly as a comma-separated list of tags/phrases in English, and DO NOT include any conversational introduction, prefix, or markdown formatting.';
    }

    try {
      const url = provider.captionEndpoint(key);
      const resp = await fetchWithRetry(
        url,
        {
          method: 'POST',
          headers: provider.buildCaptionHeaders(key),
          body: JSON.stringify(provider.buildCaptionBody(state.refImageBase64, prompt, key)),
        },
        3
      );

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(provider.parseError(errData) || `HTTP ${resp.status}`);
      }

      const data = await resp.json();
      const text = provider.parseResponse(data);
      let cleaned = text.replace(/```[a-z]*\n?/g, '').replace(/\n+/g, ', ').trim();
      cleaned = cleaned.split(',').map(t => t.trim().toLowerCase()).filter((v, idx, self) => v && self.indexOf(v) === idx).join(', ');
      
      dom.excludeFeatures.value = cleaned;
      saveConfig();
      showToast('特徵偵測成功！', 'success');
    } catch (err) {
      console.error(err);
      showToast('特徵偵測失敗：' + err.message, 'error');
    } finally {
      dom.btnDetectFeatures.disabled = false;
      dom.btnDetectFeatures.textContent = originalText;
    }
  }

  // ──────────── Main Process Pipeline ────────────
  async function processAll() {
    if (state.processing) return;
    if (state.images.length === 0) {
      showToast('請先上傳圖片', 'error');
      return;
    }

    state.processing = true;
    state.cancelRequested = false;
    state.abortController = new AbortController();
    dom.btnProcess.style.display = 'none';
    dom.btnStop.style.display = 'inline-flex';
    dom.btnExport.disabled = true;
    dom.btnClear.disabled = true;
    showProgress(true);

    const total = state.images.length;
    const hasApiKey = dom.apiKey.value.trim().length > 0;
    const targetSize = parseInt(dom.resolution.value, 10);

    // Lock all pending selected cards
    const allCards = dom.gallery.querySelectorAll('.gallery-card');
    allCards.forEach((card, idx) => {
      const entry = state.images[idx];
      if (entry && entry.selected && entry.status !== 'captioned') {
        card.classList.add('locked');
      }
    });

    let wasCancelled = false;

    for (let i = 0; i < total; i++) {
      // Check for cancellation at the start of each iteration
      if (state.cancelRequested) {
        wasCancelled = true;
        break;
      }

      const entry = state.images[i];
      if (!entry.selected) continue;

      updateProgress(`儲存裁切圖片 ${i + 1}/${total}...`, ((i) / total) * 100);

      try {
        for (const subImg of entry.images) {
          await generateFinalCrop(subImg, targetSize, entry.bgColor);
        }

        // Check again after crop (in case user cancelled during crop)
        if (state.cancelRequested) {
          wasCancelled = true;
          break;
        }

        if (hasApiKey) {
          const overwrite = dom.overwriteCaptions.checked;
          if (!entry.caption || overwrite) {
            const capPercent = ((i + 0.5) / total) * 100;
            updateProgress(`生成 Caption ${i + 1}/${total}...`, capPercent);
            
            // Pass multiple images if sequence mode and group
            let targetImgs = [entry.images[0]];
            if (state.mode === 'sequence' && entry.type === 'group' && entry.images.length > 1) {
              targetImgs = [entry.images[0], entry.images[entry.images.length - 1]];
            }
            await generateCaption(entry, targetImgs, capPercent);
          }
          
          // Update the UI for this specific card
          const cards = dom.gallery.querySelectorAll('.gallery-card');
          if(cards[i]) {
             cards[i].querySelector('.card-caption').value = entry.caption;
             cards[i].querySelector('.card-status').textContent = '✅ 已完成';
             cards[i].classList.remove('locked');
          }
        } else {
          entry.status = 'captioned';
          const cards = dom.gallery.querySelectorAll('.gallery-card');
          if(cards[i]) cards[i].classList.remove('locked');
        }
      } catch (err) {
        if (err.name === 'AbortError') {
          wasCancelled = true;
          break;
        }
        console.error(`Error processing image ${i + 1}:`, err);
        entry.status = 'error';
        entry.caption = `[錯誤] ${err.message}`;
        const cards = dom.gallery.querySelectorAll('.gallery-card');
        if(cards[i]) {
           cards[i].querySelector('.card-caption').value = entry.caption;
           cards[i].querySelector('.card-status').textContent = '❌ 發生錯誤';
           cards[i].classList.remove('locked');
        }
        showToast(`圖片 ${i + 1} 處理失敗：${err.message}`, 'error');
      }

      updateProgress(`處理中...`, ((i + 1) / total) * 100);
    }

    // Unlock all remaining locked cards
    dom.gallery.querySelectorAll('.gallery-card.locked').forEach(c => c.classList.remove('locked'));

    if (wasCancelled) {
      updateProgress('已停止處理', 0);
      setTimeout(() => showProgress(false), 1500);
      showToast('已停止處理，已完成的圖片已保留', 'info');
    } else {
      updateProgress('處理完成！', 100);
      setTimeout(() => showProgress(false), 1500);
      showToast('所有圖片處理完成！', 'success');
    }

    state.processing = false;
    state.cancelRequested = false;
    dom.btnProcess.style.display = 'inline-flex';
    dom.btnStop.style.display = 'none';
    dom.btnStop.disabled = false;
    dom.btnStop.textContent = '🛑 停止處理';
    dom.btnProcess.disabled = false;
    updateActionButtons();

    if (!hasApiKey) {
      showToast('未偵測到 API Key，已跳過 Caption 生成', 'info');
    }
  }

  // ──────────── Export ────────────
  async function exportZip() {
    const processed = state.images.filter(item => item.images.some(img => img.croppedBlob) && item.selected);
    if (processed.length === 0) {
      showToast('沒有已處理的圖片可匯出', 'error');
      return;
    }

    dom.btnExport.disabled = true;
    showToast('正在打包 ZIP...', 'info');

    try {
      const zip = new JSZip();
      const captionLines = [];

      processed.forEach((item, i) => {
        const idx = i + 1;
        if (item.type === 'single') {
           zip.file(`${idx}.png`, item.images[0].croppedBlob);
        } else {
           const len = item.images.length;
           item.images.forEach((img, k) => {
              let suffix = '';
              if (k === 0) suffix = '_start';
              else if (k === len - 1) suffix = '_end';
              else suffix = `_start${k + 1}`;
              
              zip.file(`${idx}${suffix}.png`, img.croppedBlob);
           });
        }
        
        captionLines.push(item.caption || '');
        zip.file(`${idx}.txt`, item.caption || '');
      });

      zip.file('captions_all.txt', captionLines.join('\n'));

      const blob = await zip.generateAsync({ type: 'blob' });
      saveAs(blob, 'lora_dataset.zip');
      showToast('ZIP 匯出成功！', 'success');
    } catch (err) {
      showToast('匯出失敗：' + err.message, 'error');
    } finally {
      dom.btnExport.disabled = false;
    }
  }

  // ──────────── Clear All ────────────
  function clearAll() {
    state.images.forEach(img => {
      if (img.originalUrl) URL.revokeObjectURL(img.originalUrl);
    });
    state.images = [];
    renderGallery();
    updateActionButtons();
    showToast('已清除所有圖片', 'info');
  }

  function updateActionButtons() {
    const hasImages = state.images.length > 0;
    const hasProcessed = state.images.some(item => item.images.some(img => img.croppedBlob));
    
    // Stitch mode button visibility
    // (Button moved to individual cards)

    if (state.isStitching) {
      dom.btnConfirmStitch.disabled = state.stitchSelection.length < 2;
    }
    
    dom.btnProcess.disabled = !hasImages || state.processing || state.isStitching;
    dom.btnExport.disabled = !hasProcessed || state.processing || state.isStitching;
    dom.btnClear.disabled = !hasImages || state.processing || state.isStitching;
  }

  function showProgress(show) {
    dom.progressContainer.classList.toggle('active', show);
  }

  function updateProgress(text, percent) {
    dom.progressText.textContent = text;
    if (percent !== null && percent !== undefined) {
      dom.progressPercent.textContent = `${Math.round(percent)}%`;
      dom.progressFill.style.width = `${percent}%`;
    }
  }

  // ──────────── Event Bindings ────────────
  function init() {
    loadConfig();

    dom.apiProvider.addEventListener('change', onProviderChange);
    onProviderChange();

    dom.btnTestApi.addEventListener('click', testApiConnection);
    // Work Mode Toggle
    dom.workModeRadios.forEach(radio => {
      radio.addEventListener('change', (e) => {
        state.mode = e.target.value;
        if (state.mode === 'single') {
           if (state.isStitching) dom.btnCancelStitch.click();
           dom.subjectTypeGroup.style.display = 'block';
           dom.sequenceSubjectGroup.style.display = 'none';
           dom.captionFormat.disabled = false;
           dom.formatHint.style.display = 'none';
        } else {
           dom.subjectTypeGroup.style.display = 'none';
           dom.sequenceSubjectGroup.style.display = 'block';
           dom.captionFormat.value = 'natural';
           dom.captionFormat.disabled = true;
           dom.formatHint.style.display = 'inline';
        }
        handleSubjectTypeChange();
        updateActionButtons();
      });
    });

    if (dom.btnCancelStitch) {
       dom.btnCancelStitch.addEventListener('click', () => {
         state.isStitching = false;
         state.stitchSelection = [];
         dom.btnConfirmStitch.style.display = 'none';
         dom.btnCancelStitch.style.display = 'none';
         renderGallery();
         updateActionButtons();
       });
    }

    if (dom.btnConfirmStitch) {
       dom.btnConfirmStitch.addEventListener('click', () => {
         if (state.stitchSelection.length < 2) {
           showToast('至少需要選擇 2 張圖片才能拼接', 'error');
           return;
         }
         
         const selectedIndices = [...state.stitchSelection];
         const newGroup = {
           id: Date.now() + Math.random().toString(36).slice(2, 8),
           type: 'group',
           caption: state.images[selectedIndices[0]].caption,
           status: 'pending',
           selected: true,
           bgColor: state.images[selectedIndices[0]].bgColor,
           images: []
         };
         
         selectedIndices.forEach(idx => {
            newGroup.images.push(...state.images[idx].images);
         });
         
         // Remove selected items safely (sort descending)
         const sortedIndices = [...selectedIndices].sort((a, b) => b - a);
         for (let i = 0; i < sortedIndices.length; i++) {
            state.images.splice(sortedIndices[i], 1);
         }
         
         // Insert at the position of the first clicked item (smallest index of original list)
         const minIndex = Math.min(...selectedIndices);
         state.images.splice(minIndex, 0, newGroup);
         
         state.isStitching = false;
         state.stitchSelection = [];
         dom.btnConfirmStitch.style.display = 'none';
         dom.btnCancelStitch.style.display = 'none';
         
         renderGallery();
         updateActionButtons();
         showToast(`已將 ${selectedIndices.length} 張圖片依序拼接為 1 個小組`, 'success');
       });
    }
     

    dom.dropzone.addEventListener('click', () => dom.fileInput.click());

    dom.dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dom.dropzone.classList.add('drag-over');
    });

    dom.dropzone.addEventListener('dragleave', () => {
      dom.dropzone.classList.remove('drag-over');
    });

    dom.dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dom.dropzone.classList.remove('drag-over');
      handleFiles(e.dataTransfer.files);
    });

    dom.fileInput.addEventListener('change', (e) => {
      handleFiles(e.target.files);
      e.target.value = '';
    });

    dom.btnProcess.addEventListener('click', processAll);
    dom.btnStop.addEventListener('click', () => {
      state.cancelRequested = true;
      state.abortController?.abort();
      dom.btnStop.disabled = true;
      dom.btnStop.textContent = '⏳ 正在停止...';
    });
    dom.btnExport.addEventListener('click', exportZip);
    dom.btnClear.addEventListener('click', clearAll);

    // Subject type changing logic
    const handleSubjectTypeChange = () => {
      if (state.mode === 'sequence') {
        dom.subjectRefSection.style.display = 'none';
      } else {
        const type = dom.subjectType.value;
        if (type !== 'none') {
          dom.subjectRefSection.style.display = 'block';
        } else {
          dom.subjectRefSection.style.display = 'none';
        }
      }
      saveConfig();
    };
    dom.subjectType.addEventListener('change', handleSubjectTypeChange);
    dom.sequenceSubject.addEventListener('input', saveConfig);
    handleSubjectTypeChange(); // call once initially

    dom.captionFormat.addEventListener('change', saveConfig);
    dom.excludeFeatures.addEventListener('input', saveConfig);

    // Reference Image Drag & Drop / Click Upload
    if (dom.refDropzone) {
      dom.refDropzone.addEventListener('click', (e) => {
        if (e.target.id === 'btnRemoveRef') return;
        dom.refImageInput.click();
      });

      dom.refDropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dom.refDropzone.style.borderColor = 'var(--accent-2)';
      });

      dom.refDropzone.addEventListener('dragleave', () => {
        dom.refDropzone.style.borderColor = 'var(--border)';
      });

      dom.refDropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dom.refDropzone.style.borderColor = 'var(--border)';
        if (e.dataTransfer.files.length > 0) {
          loadRefFile(e.dataTransfer.files[0]);
        }
      });
    }

    if (dom.refImageInput) {
      dom.refImageInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
          loadRefFile(e.target.files[0]);
        }
      });
    }

    if (dom.btnRemoveRef) {
      dom.btnRemoveRef.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        state.refImageBase64 = null;
        dom.refImagePreview.src = '';
        dom.refPreviewWrapper.style.display = 'none';
        dom.refImageInput.value = '';
        dom.btnDetectFeatures.disabled = true;
        showToast('已移除參考圖', 'info');
      });
    }

    if (dom.btnDetectFeatures) {
      dom.btnDetectFeatures.addEventListener('click', (e) => {
        e.preventDefault();
        detectSubjectFeatures();
      });
    }

    function loadRefFile(file) {
      if (!file.type.startsWith('image/')) {
        showToast('請上傳圖片格式檔案', 'error');
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target.result;
        dom.refImagePreview.src = dataUrl;
        dom.refPreviewWrapper.style.display = 'block';
        
        const base64 = dataUrl.split(',')[1];
        state.refImageBase64 = base64;
        dom.btnDetectFeatures.disabled = false;
        showToast('參考圖載入成功，可進行特徵偵測', 'success');
      };
      reader.readAsDataURL(file);
    }
  }

  init();
})();
