/**
 * QRIS Kasir Dashboard - TemanQRIS Clone
 * Features:
 * - Upload gambar QRIS (dropzone) → decode → convert → generate dynamic QR
 * - WebSocket real-time monitoring + polling fallback
 * - TTS Sound Alert (SpeechSynthesis API)
 * - Confetti + visual effects
 */
(function () {
  'use strict';

  // ========== STATE ==========
  let currentState = 'INPUT';
  let currentTransaction = null;
  let ws = null;
  let reconnectAttempts = 0;
  const MAX_RECONNECT = 3;
  const RECONNECT_INTERVAL = 2000;
  let reconnectTimer = null;
  let pollingInterval = null;
  let uploadedFile = null;

  // ========== DOM ELEMENTS ==========
  const stateInput = document.getElementById('state-input');
  const stateWaiting = document.getElementById('state-waiting');
  const stateSuccess = document.getElementById('state-success');

  const formCreate = document.getElementById('form-create');
  const nominalInput = document.getElementById('nominal');
  const qrisInput = document.getElementById('qris');
  const btnGenerate = document.getElementById('btn-generate');
  const errorMessage = document.getElementById('error-message');
  const soundToggle = document.getElementById('sound-toggle');
  const soundIcon = document.getElementById('sound-icon');

  const dropzone = document.getElementById('dropzone');
  const qrisFile = document.getElementById('qris-file');
  const dropzoneContent = document.getElementById('dropzone-content');
  const dropzonePreview = document.getElementById('dropzone-preview');
  const previewImage = document.getElementById('preview-image');
  const previewFilename = document.getElementById('preview-filename');

  const qrImage = document.getElementById('qr-image');
  const infoNominal = document.getElementById('info-nominal');
  const infoUnique = document.getElementById('info-unique');
  const infoTotal = document.getElementById('info-total');
  const infoMerchant = document.getElementById('info-merchant');
  const btnCancel = document.getElementById('btn-cancel');

  const successAmount = document.getElementById('success-amount');
  const successMerchant = document.getElementById('success-merchant');
  const btnNewTransaction = document.getElementById('btn-new-transaction');

  // ========== INIT ==========
  function init() {
    loadSoundPreference();
    bindEvents();
    switchState('INPUT');
  }

  // ========== EVENT BINDING ==========
  function bindEvents() {
    formCreate.addEventListener('submit', handleGenerateQR);
    btnCancel.addEventListener('click', handleCancel);
    btnNewTransaction.addEventListener('click', handleNewTransaction);
    soundToggle.addEventListener('change', handleSoundToggle);

    // Dropzone events
    qrisFile.addEventListener('change', handleFileSelect);
    dropzone.addEventListener('dragover', handleDragOver);
    dropzone.addEventListener('dragleave', handleDragLeave);
    dropzone.addEventListener('drop', handleDrop);
  }

  // ========== DROPZONE / FILE UPLOAD ==========
  function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) processFile(file);
  }

  function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.add('drag-over');
  }

  function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.remove('drag-over');
  }

  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      processFile(file);
    }
  }

  function processFile(file) {
    if (file.size > 5 * 1024 * 1024) {
      showError('Ukuran file maks 5MB');
      return;
    }
    uploadedFile = file;
    // Show preview
    const reader = new FileReader();
    reader.onload = function (e) {
      previewImage.src = e.target.result;
      previewFilename.textContent = '✓ ' + file.name;
      dropzoneContent.classList.add('hidden');
      dropzonePreview.classList.remove('hidden');
      dropzone.classList.add('has-file');
    };
    reader.readAsDataURL(file);
  }

  // ========== STATE MANAGEMENT ==========
  function switchState(state) {
    currentState = state;
    stateInput.classList.add('hidden');
    stateWaiting.classList.add('hidden');
    stateSuccess.classList.add('hidden');

    if (state === 'INPUT') stateInput.classList.remove('hidden');
    if (state === 'WAITING') stateWaiting.classList.remove('hidden');
    if (state === 'SUCCESS') {
      stateSuccess.classList.remove('hidden');
      launchConfetti();
    }
  }

  // ========== GENERATE QR FLOW ==========
  async function handleGenerateQR(e) {
    e.preventDefault();
    hideError();

    const nominal = parseInt(nominalInput.value, 10);
    if (!nominal || nominal <= 0) {
      showError('Nominal harus berupa angka positif (min Rp 100)');
      return;
    }

    // Check if we have QRIS source (file upload or text)
    const qrisText = qrisInput.value.trim();
    if (!uploadedFile && !qrisText) {
      showError('Upload gambar QRIS atau paste string QRIS terlebih dahulu');
      return;
    }

    setLoading(true);

    try {
      let qrisString = qrisText;

      // If file uploaded, decode it first
      if (uploadedFile && !qrisText) {
        qrisString = await decodeQrisImage(uploadedFile);
      }

      if (!qrisString) {
        throw new Error('Gagal mendapatkan data QRIS');
      }

      // Create transaction via cashier/create
      const res = await fetch('/cashier/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nominal: nominal, qris: qrisString }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gagal membuat transaksi');
      }

      // Store transaction
      currentTransaction = data;

      // Display QR
      qrImage.src = '/qr?text=' + encodeURIComponent(data.qrisConverted);

      // Update info panel
      infoNominal.textContent = formatRupiah(data.originalAmount);
      infoUnique.textContent = '+' + data.uniqueCode;
      infoTotal.textContent = formatRupiah(data.totalAmount);
      infoMerchant.textContent = data.merchantName || '-';

      // Switch to waiting
      switchState('WAITING');
      connectWebSocket(data.transactionId);
      startPolling(data.transactionId);

    } catch (err) {
      showError(err.message || 'Terjadi kesalahan');
    } finally {
      setLoading(false);
    }
  }

  // ========== DECODE QRIS IMAGE ==========
  async function decodeQrisImage(file) {
    const formData = new FormData();
    formData.append('image', file);

    const res = await fetch('/decode', {
      method: 'POST',
      body: formData,
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Gagal decode gambar QRIS');
    }
    return data.text;
  }

  // ========== WEBSOCKET ==========
  function connectWebSocket(transactionId) {
    closeWebSocket();
    reconnectAttempts = 0;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = protocol + '//' + window.location.host + '/ws/transaction/' + transactionId;
    openWebSocket(wsUrl, transactionId);
  }

  function openWebSocket(url, transactionId) {
    try {
      ws = new WebSocket(url);
      ws.onopen = function () { reconnectAttempts = 0; };
      ws.onmessage = function (event) {
        try {
          var message = JSON.parse(event.data);
          if (message.type === 'PAYMENT_SUCCESS') {
            onPaymentSuccess(message);
          }
        } catch (err) { /* ignore */ }
      };
      ws.onclose = function () {
        if (currentState === 'WAITING') attemptReconnect(url, transactionId);
      };
      ws.onerror = function () { /* onclose handles it */ };
    } catch (err) {
      attemptReconnect(url, transactionId);
    }
  }

  function attemptReconnect(url, transactionId) {
    if (reconnectAttempts >= MAX_RECONNECT) return; // polling is still running
    reconnectAttempts++;
    reconnectTimer = setTimeout(function () {
      if (currentState === 'WAITING') openWebSocket(url, transactionId);
    }, RECONNECT_INTERVAL);
  }

  function closeWebSocket() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (ws) { ws.onclose = null; ws.close(); ws = null; }
  }

  // ========== POLLING FALLBACK ==========
  function startPolling(transactionId) {
    stopPolling();
    pollingInterval = setInterval(async function () {
      if (currentState !== 'WAITING') { stopPolling(); return; }
      try {
        const res = await fetch('/api/check-status?transactionId=' + encodeURIComponent(transactionId));
        if (res.ok) {
          const data = await res.json();
          if (data.status === 'SUCCESS') {
            onPaymentSuccess({
              type: 'PAYMENT_SUCCESS',
              transactionId: data.transactionId,
              amount: data.amount,
              originalAmount: data.originalAmount,
              uniqueCode: data.uniqueCode,
              merchantName: data.merchantName,
            });
          }
        }
      } catch (err) { /* ignore polling errors */ }
    }, 5000);
  }

  function stopPolling() {
    if (pollingInterval) { clearInterval(pollingInterval); pollingInterval = null; }
  }

  // ========== PAYMENT SUCCESS ==========
  function onPaymentSuccess(message) {
    closeWebSocket();
    stopPolling();
    const amount = message.originalAmount || message.amount;
    successAmount.textContent = formatRupiah(amount);
    successMerchant.textContent = message.merchantName || '';
    switchState('SUCCESS');
    playSuccessSound(amount);
  }

  // ========== TTS ALERT ==========
  function playSuccessSound(amount) {
    if (!soundToggle.checked) { flashScreen(); return; }
    if (!window.speechSynthesis) { flashScreen(); return; }
    try {
      var text = 'Pembayaran sebesar ' + amount + ' rupiah berhasil diterima';
      var utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'id-ID';
      utterance.rate = 1;
      utterance.pitch = 1;
      window.speechSynthesis.speak(utterance);
    } catch (err) { flashScreen(); }
  }

  function flashScreen() {
    document.body.classList.add('flash-screen');
    setTimeout(function () { document.body.classList.remove('flash-screen'); }, 600);
  }

  // ========== CONFETTI ==========
  function launchConfetti() {
    var colors = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
    for (var i = 0; i < 50; i++) {
      var piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.left = Math.random() * 100 + 'vw';
      piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      piece.style.animationDelay = Math.random() * 1.5 + 's';
      piece.style.animationDuration = (2.5 + Math.random() * 2) + 's';
      piece.style.width = (6 + Math.random() * 8) + 'px';
      piece.style.height = (6 + Math.random() * 8) + 'px';
      piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
      document.body.appendChild(piece);
      setTimeout(function (p) { p.remove(); }, 5000, piece);
    }
  }

  // ========== CANCEL / NEW ==========
  function handleCancel() {
    closeWebSocket();
    stopPolling();
    currentTransaction = null;
    switchState('INPUT');
  }

  function handleNewTransaction() {
    closeWebSocket();
    stopPolling();
    currentTransaction = null;
    uploadedFile = null;
    nominalInput.value = '';
    qrisInput.value = '';
    resetDropzone();
    switchState('INPUT');
  }

  function resetDropzone() {
    dropzoneContent.classList.remove('hidden');
    dropzonePreview.classList.add('hidden');
    dropzone.classList.remove('has-file');
    qrisFile.value = '';
  }

  // ========== SOUND TOGGLE ==========
  function handleSoundToggle() {
    var enabled = soundToggle.checked;
    soundIcon.textContent = enabled ? '🔊' : '🔇';
    localStorage.setItem('qris-sound-enabled', enabled ? '1' : '0');
  }

  function loadSoundPreference() {
    var saved = localStorage.getItem('qris-sound-enabled');
    if (saved === '0') { soundToggle.checked = false; soundIcon.textContent = '🔇'; }
    else { soundToggle.checked = true; soundIcon.textContent = '🔊'; }
  }

  // ========== HELPERS ==========
  function formatRupiah(amount) {
    return 'Rp ' + Number(amount).toLocaleString('id-ID');
  }

  function showError(msg) {
    errorMessage.textContent = msg;
    errorMessage.classList.remove('hidden');
  }

  function hideError() {
    errorMessage.textContent = '';
    errorMessage.classList.add('hidden');
  }

  function setLoading(loading) {
    if (loading) {
      btnGenerate.disabled = true;
      btnGenerate.classList.add('btn-loading');
      btnGenerate.innerHTML = '<svg class="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg> Memproses...';
    } else {
      btnGenerate.disabled = false;
      btnGenerate.classList.remove('btn-loading');
      btnGenerate.innerHTML = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg> Generate QR Pembayaran';
    }
  }

  // ========== BOOT ==========
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
