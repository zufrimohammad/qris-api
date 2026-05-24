/**
 * QRIS Kasir Dashboard - Frontend Logic
 * State management: INPUT → WAITING → SUCCESS
 * WebSocket real-time payment monitoring
 * TTS Alert using SpeechSynthesis API
 */

(function () {
  'use strict';

  // ========== STATE ==========
  let currentState = 'INPUT'; // INPUT | WAITING | SUCCESS
  let currentTransaction = null;
  let ws = null;
  let reconnectAttempts = 0;
  const MAX_RECONNECT = 3;
  const RECONNECT_INTERVAL = 2000;
  let reconnectTimer = null;

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

  const qrImage = document.getElementById('qr-image');
  const infoNominal = document.getElementById('info-nominal');
  const infoUnique = document.getElementById('info-unique');
  const infoTotal = document.getElementById('info-total');
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
  }

  // ========== STATE MANAGEMENT ==========
  function switchState(state) {
    currentState = state;

    stateInput.classList.add('hidden');
    stateWaiting.classList.add('hidden');
    stateSuccess.classList.add('hidden');

    switch (state) {
      case 'INPUT':
        stateInput.classList.remove('hidden');
        break;
      case 'WAITING':
        stateWaiting.classList.remove('hidden');
        break;
      case 'SUCCESS':
        stateSuccess.classList.remove('hidden');
        launchConfetti();
        break;
    }
  }

  // ========== GENERATE QR FLOW ==========
  async function handleGenerateQR(e) {
    e.preventDefault();
    hideError();

    const nominal = parseInt(nominalInput.value, 10);
    const qris = qrisInput.value.trim();

    if (!nominal || nominal <= 0) {
      showError('Nominal harus berupa angka positif');
      return;
    }
    if (!qris) {
      showError('QRIS string tidak boleh kosong');
      return;
    }

    // Disable button while processing
    btnGenerate.disabled = true;
    btnGenerate.textContent = 'Memproses...';

    try {
      const res = await fetch('/cashier/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nominal, qris }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || data.message || `HTTP ${res.status}`);
      }

      // Store transaction data
      currentTransaction = {
        transactionId: data.transactionId,
        originalAmount: data.originalAmount,
        uniqueCode: data.uniqueCode,
        totalAmount: data.totalAmount,
        qrisConverted: data.qrisConverted,
        merchantName: data.merchantName,
      };

      // Display QR
      qrImage.src = '/qr?text=' + encodeURIComponent(data.qrisConverted);

      // Update info
      infoNominal.textContent = formatRupiah(data.originalAmount);
      infoUnique.textContent = '+' + data.uniqueCode;
      infoTotal.textContent = formatRupiah(data.totalAmount);

      // Switch to waiting and connect WebSocket
      switchState('WAITING');
      connectWebSocket(data.transactionId);
    } catch (err) {
      showError(err.message || 'Gagal membuat transaksi');
    } finally {
      btnGenerate.disabled = false;
      btnGenerate.textContent = 'Generate QR';
    }
  }

  // ========== WEBSOCKET ==========
  function connectWebSocket(transactionId) {
    closeWebSocket();
    reconnectAttempts = 0;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/transaction/${transactionId}`;

    openWebSocket(wsUrl, transactionId);
  }

  function openWebSocket(url, transactionId) {
    try {
      ws = new WebSocket(url);

      ws.onopen = function () {
        reconnectAttempts = 0;
      };

      ws.onmessage = function (event) {
        try {
          const message = JSON.parse(event.data);
          handleWebSocketMessage(message);
        } catch (err) {
          // Ignore non-JSON messages
        }
      };

      ws.onclose = function () {
        if (currentState === 'WAITING') {
          attemptReconnect(url, transactionId);
        }
      };

      ws.onerror = function () {
        // onclose will fire after onerror
      };
    } catch (err) {
      attemptReconnect(url, transactionId);
    }
  }

  function handleWebSocketMessage(message) {
    if (message.type === 'PAYMENT_SUCCESS') {
      // Payment confirmed!
      const amount = message.originalAmount || message.amount;
      showSuccess(amount, message.merchantName);
    }
  }

  function attemptReconnect(url, transactionId) {
    if (reconnectAttempts >= MAX_RECONNECT) {
      showError('Koneksi terputus. Silakan refresh halaman atau coba lagi.');
      switchState('INPUT');
      return;
    }

    reconnectAttempts++;
    reconnectTimer = setTimeout(function () {
      if (currentState === 'WAITING') {
        openWebSocket(url, transactionId);
      }
    }, RECONNECT_INTERVAL);
  }

  function closeWebSocket() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws) {
      ws.onclose = null; // Prevent reconnect on intentional close
      ws.close();
      ws = null;
    }
  }

  // ========== SUCCESS FLOW ==========
  function showSuccess(amount, merchantName) {
    closeWebSocket();
    successAmount.textContent = formatRupiah(amount);
    successMerchant.textContent = merchantName || '';
    switchState('SUCCESS');

    // Play TTS alert
    playSuccessSound(amount);
  }

  // ========== TTS ALERT (Task 6.4) ==========
  function playSuccessSound(amount) {
    // Respect sound toggle setting
    if (!soundToggle.checked) {
      // Sound disabled, do visual fallback
      flashScreen();
      return;
    }

    // Check SpeechSynthesis availability
    if (!window.speechSynthesis) {
      // Fallback to visual notification only
      flashScreen();
      return;
    }

    try {
      const text = 'Pembayaran sebesar ' + amount + ' rupiah berhasil diterima';
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'id-ID';
      utterance.rate = 1;
      utterance.pitch = 1;
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      // Fallback to visual notification
      flashScreen();
    }
  }

  function flashScreen() {
    document.body.classList.add('flash-screen');
    setTimeout(function () {
      document.body.classList.remove('flash-screen');
    }, 600);
  }

  // ========== CONFETTI ==========
  function launchConfetti() {
    const colors = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
    const container = document.body;

    for (let i = 0; i < 60; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.left = Math.random() * 100 + 'vw';
      piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      piece.style.animationDelay = Math.random() * 1.5 + 's';
      piece.style.animationDuration = (2 + Math.random() * 2) + 's';
      piece.style.width = (6 + Math.random() * 8) + 'px';
      piece.style.height = (6 + Math.random() * 8) + 'px';
      piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '0';
      container.appendChild(piece);

      // Cleanup after animation
      setTimeout(function () {
        piece.remove();
      }, 4500);
    }
  }

  // ========== CANCEL / NEW TRANSACTION ==========
  function handleCancel() {
    closeWebSocket();
    currentTransaction = null;
    switchState('INPUT');
  }

  function handleNewTransaction() {
    closeWebSocket();
    currentTransaction = null;
    nominalInput.value = '';
    switchState('INPUT');
  }

  // ========== SOUND TOGGLE ==========
  function handleSoundToggle() {
    const enabled = soundToggle.checked;
    soundIcon.textContent = enabled ? '🔊' : '🔇';
    localStorage.setItem('qris-sound-enabled', enabled ? '1' : '0');
  }

  function loadSoundPreference() {
    const saved = localStorage.getItem('qris-sound-enabled');
    if (saved === '0') {
      soundToggle.checked = false;
      soundIcon.textContent = '🔇';
    } else {
      soundToggle.checked = true;
      soundIcon.textContent = '🔊';
    }
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

  // ========== BOOT ==========
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
