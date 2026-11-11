/* Browser-only submission editor. ZIP uses the uncompressed ZIP32 format. */
(() => {
  'use strict';
  const root = document.getElementById('person-editor');
  if (!root) return;
  const form = document.getElementById('person-form');
  const errorBox = document.getElementById('editor-error');
  const draftStatus = document.getElementById('draft-status');
  const downloadStatus = document.getElementById('download-status');
  const panels = [...root.querySelectorAll('[data-panel]')];
  const stepButtons = [...root.querySelectorAll('[data-step]')];
  const storageKey = 'golden-shelf.person-draft.v1';
  const existingIds = JSON.parse(root.dataset.existing || '[]');
  const imageExtensions = ['jpg', 'jpeg', 'png', 'webp'];
  const fields = ['name', 'author_id', 'bio_short', 'biography', 'degree', 'academic_title', 'science_field', 'years_at_kgik', 'bibliography'];
  const books = [];
  const media = [];
  let portrait = null;
  let portraitName = '';
  let step = 0;
  let changed = false;
  let revision = 0;
  let saveTimer;
  const objectUrls = new Set();

  function notifyError(message) {
    errorBox.textContent = message;
    errorBox.hidden = !message;
    if (message) errorBox.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function extension(name) {
    return name.split('.').pop().toLowerCase();
  }

  function fileRule(file, type) {
    const allowed = type === 'pdf' ? ['pdf'] : type === 'audio' ? ['mp3'] : imageExtensions;
    if (!allowed.includes(extension(file.name))) return `Допустимые форматы: ${allowed.join(', ')}.`;
    if (!file.size) return 'Файл пустой. Выберите другой файл.';
    if (file.size > 25 * 1024 * 1024) return 'Размер одного файла должен быть не больше 25 МБ.';
    return '';
  }

  function filePreview(container, file, savedName = '') {
    container.querySelectorAll('img').forEach(img => {
      URL.revokeObjectURL(img.src);
      objectUrls.delete(img.src);
    });
    container.replaceChildren();
    if (!file && !savedName) return;
    const caption = document.createElement('p');
    caption.className = 'editor-help';
    caption.textContent = file ? `Выбран файл: ${file.name}` : `Выберите файл заново: ${savedName}`;
    container.append(caption);
    if (file && imageExtensions.includes(extension(file.name))) {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(file);
      objectUrls.add(img.src);
      img.alt = 'Предпросмотр выбранного изображения';
      container.append(img);
    }
  }

  function personData() {
    return Object.fromEntries(fields.map(key => [key, form.elements.namedItem(key).value.trim()]));
  }

  function entryData(entry) {
    return Object.fromEntries([...entry.node.querySelectorAll('[data-key]')].map(input => [input.dataset.key, input.value.trim()]));
  }

  function snapshot() {
    return {
      version: 1,
      person: personData(),
      portraitName,
      books: books.map(entry => ({ ...entryData(entry), fileName: entry.fileName })),
      media: media.map(entry => ({ ...entryData(entry), fileName: entry.fileName }))
    };
  }

  function saveDraft() {
    clearTimeout(saveTimer);
    try {
      localStorage.setItem(storageKey, JSON.stringify(snapshot()));
      draftStatus.textContent = 'Текстовый черновик сохранён в этом браузере. После перезагрузки выберите вложения заново.';
    } catch {
      draftStatus.textContent = 'Браузер не разрешил сохранить черновик. Скачайте архив до закрытия страницы.';
    }
  }

  function markChanged() {
    revision++;
    changed = true;
    document.getElementById('confirmed').checked = false;
    downloadStatus.textContent = '';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDraft, 300);
  }

  function bindFile(input, entry, typeGetter, container) {
    input.addEventListener('change', () => {
      const file = input.files[0];
      if (file) {
        const error = fileRule(file, typeGetter());
        if (error) {
          input.value = '';
          notifyError(error);
          return;
        }
      }
      entry.file = file || null;
      entry.fileName = file ? file.name : '';
      filePreview(container, entry.file, entry.fileName);
      notifyError('');
      markChanged();
    });
  }

  function refreshLegends(list, label) {
    list.forEach((entry, index) => { entry.node.querySelector('legend').textContent = `${label} ${index + 1}`; });
  }

  function addEntry(kind, saved = {}) {
    const isBook = kind === 'book';
    const list = isBook ? books : media;
    const template = document.getElementById(`${kind}-template`);
    const node = template.content.firstElementChild.cloneNode(true);
    const entry = { node, file: null, fileName: saved.fileName || '' };
    node.querySelectorAll('[data-key]').forEach(input => {
      if (saved[input.dataset.key] !== undefined) input.value = saved[input.dataset.key];
    });
    document.getElementById(`${kind}-entries`).append(node);
    list.push(entry);
    const preview = node.querySelector('[data-file-preview]');
    const fileInput = node.querySelector('[data-file]');
    bindFile(fileInput, entry, () => isBook ? 'image' : node.querySelector('[data-key="type"]').value, preview);
    node.querySelector('[data-clear-file]').addEventListener('click', () => {
      entry.file = null;
      entry.fileName = '';
      fileInput.value = '';
      filePreview(preview, null);
      markChanged();
    });
    node.querySelector('[data-remove]').addEventListener('click', () => {
      if (!window.confirm('Удалить эту карточку вместе с введёнными сведениями?')) return;
      filePreview(preview, null);
      node.remove();
      list.splice(list.indexOf(entry), 1);
      refreshLegends(list, isBook ? 'Книга' : 'Материал');
      markChanged();
    });
    if (!isBook) {
      const typeInput = node.querySelector('[data-key="type"]');
      const urlInput = node.querySelector('[data-key="url"]');
      function updateType(clearFile) {
        const isLink = typeInput.value === 'link';
        node.querySelector('[data-file-label]').hidden = isLink;
        node.querySelector('[data-clear-file]').hidden = isLink;
        fileInput.disabled = isLink;
        node.querySelector('[data-url-label]').hidden = !isLink;
        urlInput.disabled = !isLink;
        urlInput.required = isLink;
        fileInput.accept = typeInput.value === 'pdf' ? 'application/pdf' : typeInput.value === 'audio' ? 'audio/mpeg,.mp3' : 'image/jpeg,image/png,image/webp';
        if (clearFile) {
          entry.file = null;
          entry.fileName = '';
          fileInput.value = '';
          filePreview(preview, null);
        }
      }
      typeInput.addEventListener('change', () => updateType(true));
      updateType(false);
    }
    filePreview(preview, null, entry.fileName);
    refreshLegends(list, isBook ? 'Книга' : 'Материал');
    return entry;
  }

  function suggestId() {
    const letters = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
    const name = form.elements.namedItem('name').value.trim().toLowerCase();
    const result = [...name].map(char => letters[char] ?? char).join('').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
    form.elements.namedItem('author_id').value = result;
    markChanged();
  }

  function validatePanel(index) {
    const controls = [...panels[index].querySelectorAll('input, textarea, select')];
    for (const input of controls) {
      if (input.disabled) continue;
      input.setCustomValidity('');
      if (input.required && input.type !== 'file' && input.type !== 'checkbox' && !input.value.trim()) input.setCustomValidity('Заполните это поле.');
      if (input.type === 'url' && input.value) {
        try {
          const url = new URL(input.value);
          if (!['https:', 'http:'].includes(url.protocol)) throw new Error();
        } catch {
          input.setCustomValidity('Введите полную ссылку, начинающуюся с https:// или http://.');
        }
      }
      if (input.name === 'author_id' && existingIds.includes(input.value.trim())) input.setCustomValidity('Этот преподаватель уже есть на сайте. Уточните данные у ответственного за выставку.');
      if (!input.checkValidity()) {
        showStep(index, false);
        input.reportValidity();
        return false;
      }
    }
    return true;
  }

  function showStep(index, focus = true) {
    step = index;
    panels.forEach((panel, i) => { panel.hidden = i !== step; });
    stepButtons.forEach((button, i) => {
      if (i === step) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
    document.getElementById('previous-step').hidden = step === 0;
    document.getElementById('next-step').hidden = step === 3;
    if (step === 3) renderReview();
    if (focus) panels[step].querySelector('h2').focus();
  }

  function navigate(index) {
    notifyError('');
    if (index > step) {
      for (let i = 0; i < index; i++) if (!validatePanel(i)) return;
    }
    showStep(index);
  }

  function reviewBlock(title, text, file, fileName) {
    const block = document.createElement('section');
    block.className = 'editor-review-block';
    const heading = document.createElement('h3');
    heading.textContent = title;
    const body = document.createElement('div');
    body.className = 'editor-review-text';
    body.textContent = text;
    block.append(heading, body);
    const preview = document.createElement('div');
    filePreview(preview, file, fileName);
    block.append(preview);
    return block;
  }

  function renderReview() {
    const container = document.getElementById('review');
    container.querySelectorAll('img').forEach(img => { URL.revokeObjectURL(img.src); objectUrls.delete(img.src); });
    container.replaceChildren();
    const person = personData();
    container.append(reviewBlock(person.name, [person.bio_short, person.biography, person.degree, person.academic_title, person.science_field, person.years_at_kgik].filter(Boolean).join('\n\n'), portrait, portraitName));
    books.forEach((entry, index) => {
      const book = entryData(entry);
      container.append(reviewBlock(`Книга ${index + 1}. ${book.title}`, `${book.description}\n\n${book.annotation}`, entry.file, entry.fileName));
    });
    media.forEach((entry, index) => {
      const item = entryData(entry);
      container.append(reviewBlock(`Материал ${index + 1}. ${item.label}`, item.type === 'link' ? item.url : item.type.toUpperCase(), entry.file, entry.fileName));
    });
    if (person.bibliography) container.append(reviewBlock('Полный список работ', person.bibliography));
  }

  function markdown(data, body) {
    const yaml = Object.entries(data).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n');
    // Keep student text literal during Liquid evaluation, then let Jekyll render Markdown.
    const literal = body.replace(/{%-?\s*endraw\s*-?%}/g, tag => `{% endraw %}&#123;${tag.slice(1)}{% raw %}`);
    return `---\n${yaml}\n---\n\n{% raw %}\n${literal}\n{% endraw %}\n`;
  }

  async function exportFiles() {
    const person = personData();
    const author = person.author_id;
    const assets = `assets/images/persons/${author}`;
    const files = [];
    const allFiles = [portrait, ...books.map(entry => entry.file), ...media.map(entry => entry.file)].filter(Boolean);
    if (allFiles.reduce((size, file) => size + file.size, 0) > 100 * 1024 * 1024) throw new Error('Общий размер вложений превышает 100 МБ. Уменьшите файлы.');
    const missing = [];
    if (portraitName && !portrait) missing.push(`портрет (${portraitName})`);
    [...books, ...media].forEach(entry => { if (entry.fileName && !entry.file) missing.push(entry.fileName); });
    if (missing.length) throw new Error(`После восстановления черновика нужно выбрать вложения заново: ${missing.join(', ')}.`);
    function attach(file, stem) {
      const path = `${assets}/${stem}.${extension(file.name)}`;
      files.push({ path, data: file });
      return `/${path}`;
    }
    const metadata = { layout: 'person', title: person.name, name: person.name, author_id: author, bio_short: person.bio_short };
    for (const key of ['degree', 'academic_title', 'science_field', 'years_at_kgik']) if (person[key]) metadata[key] = person[key];
    if (portrait) metadata.photo = attach(portrait, 'portrait');
    metadata.bibliography = person.bibliography.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    metadata.media = media.map((entry, index) => {
      const item = entryData(entry);
      return { type: item.type, label: item.label, url: item.type === 'link' ? item.url : attach(entry.file, `media${index + 1}`) };
    });
    books.forEach((entry, index) => {
      const book = entryData(entry);
      const data = { layout: 'work', title: book.title, author_id: author };
      if (entry.file) data.cover = attach(entry.file, `book${index + 1}`);
      const body = `## Библиографическое описание\n\n${book.description}\n\n## Аннотация\n\n${book.annotation}`;
      files.push({ path: `_works/${author}${index + 1}.md`, data: markdown(data, body) });
    });
    files.push({ path: `_persons/${author}.md`, data: markdown(metadata, person.biography) });
    return { files, author };
  }

  // Standard ZIP32 archive, stored entries, UTF-8 filenames, CRC-32 checksums.
  // No network services or third-party libraries are needed to package attachments.
  const crcTable = Array.from({ length: 256 }, (_, value) => {
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
  });
  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const value of bytes) crc = crcTable[(crc ^ value) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
  async function zipArchive(files) {
    if (files.length > 65535) throw new Error('Слишком много файлов для одного архива.');
    const encoder = new TextEncoder();
    const chunks = [];
    const directory = [];
    let offset = 0;
    let directorySize = 0;
    for (const file of files) {
      const name = encoder.encode(file.path);
      const bytes = typeof file.data === 'string' ? encoder.encode(file.data) : new Uint8Array(await file.data.arrayBuffer());
      const crc = crc32(bytes);
      const local = new Uint8Array(30 + name.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true);
      lv.setUint16(12, 0x0021, true); // 1980-01-01, valid DOS date.
      lv.setUint32(14, crc, true);
      lv.setUint32(18, bytes.length, true);
      lv.setUint32(22, bytes.length, true);
      lv.setUint16(26, name.length, true);
      local.set(name, 30);
      chunks.push(local, bytes);
      const central = new Uint8Array(46 + name.length);
      const cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(14, 0x0021, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, bytes.length, true);
      cv.setUint32(24, bytes.length, true);
      cv.setUint16(28, name.length, true);
      cv.setUint32(42, offset, true);
      central.set(name, 46);
      directory.push(central);
      directorySize += central.length;
      offset += local.length + bytes.length;
    }
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, directorySize, true);
    ev.setUint32(16, offset, true);
    return new Blob([...chunks, ...directory, end], { type: 'application/zip' });
  }

  document.getElementById('portrait').addEventListener('change', event => {
    const file = event.target.files[0];
    if (file) {
      const error = fileRule(file, 'image');
      if (error) { event.target.value = ''; notifyError(error); return; }
    }
    portrait = file || null;
    portraitName = file ? file.name : '';
    filePreview(document.getElementById('portrait-preview'), portrait);
    notifyError('');
    markChanged();
  });
  document.getElementById('clear-portrait').addEventListener('click', () => {
    portrait = null;
    portraitName = '';
    document.getElementById('portrait').value = '';
    filePreview(document.getElementById('portrait-preview'), null);
    markChanged();
  });
  document.getElementById('suggest-id').addEventListener('click', suggestId);
  form.elements.namedItem('name').addEventListener('blur', () => {
    if (!form.elements.namedItem('author_id').value.trim()) suggestId();
  });
  form.addEventListener('input', event => {
    event.target.setCustomValidity?.('');
    if (event.target.id !== 'confirmed') markChanged();
  });
  form.addEventListener('change', event => {
    if (event.target.id !== 'confirmed') markChanged();
  });
  form.addEventListener('submit', event => event.preventDefault());
  document.getElementById('add-book').addEventListener('click', () => { const entry = addEntry('book'); entry.node.querySelector('input').focus(); markChanged(); });
  document.getElementById('add-media').addEventListener('click', () => { const entry = addEntry('media'); entry.node.querySelector('select').focus(); markChanged(); });
  stepButtons.forEach(button => button.addEventListener('click', () => navigate(Number(button.dataset.step))));
  document.getElementById('previous-step').addEventListener('click', () => navigate(step - 1));
  document.getElementById('next-step').addEventListener('click', () => navigate(step + 1));
  document.getElementById('clear-draft').addEventListener('click', () => {
    if (!window.confirm('Очистить все введённые сведения и выбранные файлы?')) return;
    clearTimeout(saveTimer);
    form.reset();
    [...books, ...media].forEach(entry => entry.node.remove());
    books.length = 0;
    media.length = 0;
    portrait = null;
    portraitName = '';
    filePreview(document.getElementById('portrait-preview'), null);
    document.getElementById('review').replaceChildren();
    objectUrls.forEach(url => URL.revokeObjectURL(url));
    objectUrls.clear();
    try { localStorage.removeItem(storageKey); } catch { /* Storage may be disabled. */ }
    form.querySelectorAll('input, textarea, select').forEach(input => input.setCustomValidity(''));
    changed = false;
    notifyError('');
    downloadStatus.textContent = '';
    draftStatus.textContent = 'Черновик очищен.';
    showStep(0);
  });
  document.getElementById('download-archive').addEventListener('click', async event => {
    for (let index = 0; index < 3; index++) if (!validatePanel(index)) return;
    if (!document.getElementById('confirmed').checked) { notifyError('Подтвердите проверку материалов перед скачиванием.'); return; }
    const button = event.currentTarget;
    const exportRevision = revision;
    button.disabled = true;
    notifyError('');
    downloadStatus.textContent = 'Подготавливаем архив…';
    try {
      const { files, author } = await exportFiles();
      const archive = await zipArchive(files);
      const url = URL.createObjectURL(archive);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${author}-materials.zip`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      saveDraft();
      changed = revision !== exportRevision;
      downloadStatus.textContent = 'Архив подготовлен. Проверьте загрузки браузера и передайте ZIP ответственному за выставку.';
    } catch (error) {
      downloadStatus.textContent = '';
      notifyError(error.message || 'Не удалось собрать архив. Повторите попытку.');
    } finally {
      button.disabled = false;
    }
  });
  window.addEventListener('beforeunload', event => {
    if (!changed) return;
    saveDraft();
    event.preventDefault();
    event.returnValue = '';
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && changed) saveDraft(); });
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (saved && saved.version === 1 && saved.person && Array.isArray(saved.books) && Array.isArray(saved.media)) {
      fields.forEach(key => { if (typeof saved.person[key] === 'string') form.elements.namedItem(key).value = saved.person[key]; });
      portraitName = saved.portraitName || '';
      saved.books.forEach(book => addEntry('book', book));
      saved.media.forEach(item => addEntry('media', item));
      filePreview(document.getElementById('portrait-preview'), null, portraitName);
      draftStatus.textContent = 'Текстовый черновик восстановлен. Ранее выбранные файлы нужно приложить заново.';
    }
  } catch {
    draftStatus.textContent = 'Не удалось восстановить черновик. Можно заполнить новую форму.';
  }
  showStep(0, false);
})();
