// ai_metabolite.js - AI assistant wiring for the metabolite dashboard
(() => {
  const API_URL = 'https://paad-groq-proxy.kumarprincebt.workers.dev/api/chat';

  const els = {
    fab: document.getElementById('ai-fab-btn'),
    panel: document.getElementById('ai-panel'),
    chatLog: document.getElementById('ai-chat-log'),
    input: document.getElementById('ai-input'),
    send: document.getElementById('ai-send-btn'),
    clear: document.getElementById('ai-clear-btn'),
    close: document.getElementById('ai-close-btn'),
    typing: document.getElementById('ai-typing')
  };

  const state = { open: false };

  // ---------- UI helpers ----------
  function openChatPanel() {
    state.open = true;
    if (els.panel) els.panel.classList.add('open');
  }

  function closeChatPanel() {
    state.open = false;
    if (els.panel) els.panel.classList.remove('open');
  }

  function appendMessage(role, text) {
    if (!els.chatLog) return;
    const div = document.createElement('div');
    div.className = `ai-message ${role} ai-markdown`;
    div.innerHTML = renderMarkdown(safe(text));
    els.chatLog.appendChild(div);
    els.chatLog.scrollTop = els.chatLog.scrollHeight;
  }
  function appendUserMessage(text) { appendMessage('user', text); }
  function appendAssistantMessage(text) { appendMessage('assistant', text); }

  function showTypingIndicator() {
    if (els.typing) els.typing.style.display = 'block';
  }
  function hideTypingIndicator() {
    if (els.typing) els.typing.style.display = 'none';
  }

  function safe(str) {
    return String(str).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }
  function renderMarkdown(str) {
    let html = str;
    html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/^\s*[-*]\s+(.*)$/gm, '<ul><li>$1</li></ul>');
    html = html.replace(/<\/ul>\s*<ul>/g, '');
    return html;
  }

  // ---------- Data helpers ----------
  function topMetabolites(arr, n = 5) {
    if (!Array.isArray(arr)) return [];
    return [...arr]
      .filter(r => typeof r?.p === 'number')
      .sort((a, b) => a.p - b.p)
      .slice(0, n)
      .map(r => ({
        metabolite: r.metabolite,
        class: r.class,
        hmdb: r.hmdb,
        p: r.p,
        log2fc: r.log2fc,
        fc: r.fc
      }));
  }

  function summarizeSamples(sampleMeta = []) {
    const summary = { normal: 0, tumor: 0, other: 0 };
    sampleMeta.forEach(s => {
      const group = (s.group || '').toLowerCase();
      if (group.startsWith('normal')) summary.normal += 1;
      else if (group.startsWith('tumor')) summary.tumor += 1;
      else summary.other += 1;
    });
    return summary;
  }

  function getSnapshot() {
    const data = window.metaboliteData || {};
    const sampleSummary = summarizeSamples(data.sampleMeta || []);
    return {
      filters: data.filters || {},
      summary: data.summary || null,
      sampleSummary,
      counts: {
        totalMetabolites: Array.isArray(data.metabolites) ? data.metabolites.length : 0,
        filteredMetabolites: Array.isArray(data.filtered) ? data.filtered.length : 0
      },
      topHits: topMetabolites(data.filtered || data.metabolites),
      selected: data.selected ? {
        metabolite: data.selected.metabolite,
        class: data.selected.class,
        hmdb: data.selected.hmdb,
        log2fc: data.selected.log2fc,
        fc: data.selected.fc,
        p: data.selected.p,
        normalMean: data.selected.normalMean,
        tumorMean: data.selected.tumorMean
      } : null
    };
  }

  // ---------- Network ----------
  async function sendToAI(payload) {
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        console.error('AI ERROR:', `HTTP ${res.status}`);
        return { reply: 'Sorry, the AI service is unavailable right now.', error: true };
      }
      const json = await res.json();
      return { reply: json.reply || json.text || 'No response.' };
    } catch (err) {
      console.error('AI ERROR:', err);
      return { reply: 'Sorry, the AI service is unavailable right now.', error: true };
    }
  }

  // ---------- Chat send ----------
  async function handleSendMessage() {
    if (!els.input) return;
    const userText = els.input.value.trim();
    if (!userText) return;
    els.input.value = '';
    appendUserMessage(userText);
    openChatPanel();
    showTypingIndicator();
    try {
      const context = getSnapshot();
      const { reply } = await sendToAI({ user_message: userText, task: 'chat', context });
      appendAssistantMessage(reply);
    } finally {
      hideTypingIndicator();
    }
  }

  // ---------- Structured tasks ----------
  async function interpretVolcano() {
    openChatPanel();
    showTypingIndicator();
    try {
      appendUserMessage('Explain the volcano plot for the current filters.');
      const context = getSnapshot();
      const { reply } = await sendToAI({
        user_message: 'Explain the metabolite volcano plot.',
        task: 'interpret_volcano',
        context
      });
      appendAssistantMessage(reply);
    } finally {
      hideTypingIndicator();
    }
  }

  async function explainSelection() {
    openChatPanel();
    showTypingIndicator();
    try {
      const data = window.metaboliteData || {};
      const sel = data.selected;
      if (!sel) {
        appendAssistantMessage('Select a metabolite in the table or charts first.');
        return;
      }
      const groupStats = {};
      (sel.sampleValues || []).forEach(sv => {
        if (!Number.isFinite(sv?.value)) return;
        const key = (sv.group || 'Unknown').toLowerCase();
        if (!groupStats[key]) groupStats[key] = [];
        groupStats[key].push(sv.value);
      });
      appendUserMessage(`Explain the selected metabolite: ${sel.metabolite || 'Unknown'}.`);
      const { reply } = await sendToAI({
        user_message: 'Explain the selected metabolite with group differences.',
        task: 'metabolite_detail',
        context: {
          selection: {
            metabolite: sel.metabolite,
            class: sel.class,
            hmdb: sel.hmdb,
            log2fc: sel.log2fc,
            fc: sel.fc,
            p: sel.p,
            normalMean: sel.normalMean,
            tumorMean: sel.tumorMean
          },
          groupStats,
          filters: data.filters || {}
        }
      });
      appendAssistantMessage(reply);
    } finally {
      hideTypingIndicator();
    }
  }

  async function summarizeFilters() {
    openChatPanel();
    showTypingIndicator();
    try {
      appendUserMessage('Summarize the current metabolite filters and highlights.');
      const context = getSnapshot();
      const { reply } = await sendToAI({
        user_message: 'Summarize the current filters and notable metabolites.',
        task: 'filter_summary',
        context
      });
      appendAssistantMessage(reply);
    } finally {
      hideTypingIndicator();
    }
  }

  // ---------- Event wiring ----------
  if (els.fab) {
    els.fab.addEventListener('click', () => {
      if (state.open) closeChatPanel();
      else openChatPanel();
    });
  }
  if (els.send) els.send.addEventListener('click', handleSendMessage);
  if (els.input) {
    els.input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSendMessage();
      }
    });
  }
  if (els.clear) {
    els.clear.addEventListener('click', () => {
      if (!els.chatLog) return;
      els.chatLog.innerHTML = '';
      appendAssistantMessage('Chat cleared. How can I help?');
    });
  }
  if (els.close) {
    els.close.addEventListener('click', () => closeChatPanel());
  }

  // ---------- Expose API ----------
  window.aiMetabolite = {
    openChatPanel,
    closeChatPanel,
    appendUserMessage,
    appendAssistantMessage,
    showTypingIndicator,
    hideTypingIndicator,
    sendToAI,
    interpretVolcano,
    explainSelection,
    summarizeFilters
  };
})();
