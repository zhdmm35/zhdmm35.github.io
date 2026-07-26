(() => {
  const endpoint = document.currentScript?.dataset.endpoint?.trim();
  if (!endpoint) return;

  let indexPromise;

  const stripHtml = html => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script, style').forEach(node => node.remove());
    return doc.body.textContent.replace(/\s+/g, ' ').trim();
  };

  const getTerms = query => {
    const terms = query.toLowerCase().match(/[a-z0-9][a-z0-9_.+-]{1,}/g) || [];
    const ignored = new Set(['怎么', '什么', '如何', '一下', '请问', '博客', '文章']);

    for (const chunk of query.match(/[\u4e00-\u9fff]+/g) || []) {
      if (chunk.length <= 4) terms.push(chunk);
      for (let i = 0; i < chunk.length - 1; i++) terms.push(chunk.slice(i, i + 2));
    }

    return [...new Set(terms.filter(term => term.length > 1 && !ignored.has(term)))];
  };

  const loadIndex = () => {
    indexPromise ||= fetch('/search.xml')
      .then(response => {
        if (!response.ok) throw new Error('文章索引加载失败');
        return response.text();
      })
      .then(xml => {
        const doc = new DOMParser().parseFromString(xml, 'application/xml');
        return [...doc.querySelectorAll('entry')].map(entry => ({
          title: entry.querySelector('title')?.textContent.trim() || '',
          url: entry.querySelector('url')?.textContent.trim() || '',
          text: stripHtml(entry.querySelector('content')?.textContent || '')
        }));
      });
    return indexPromise;
  };

  const search = async query => {
    const terms = getTerms(query);
    if (!terms.length) return [];

    return (await loadIndex())
      .map(item => {
        const title = item.title.toLowerCase();
        const text = item.text.toLowerCase();
        const score = terms.reduce((total, term) => {
          const titleScore = title.includes(term) ? 6 : 0;
          const contentScore = Math.min(text.split(term).length - 1, 3);
          return total + titleScore + contentScore;
        }, 0);
        return { ...item, score };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .map(({ title, url, text }) => ({ title, url, text: text.slice(0, 1400) }));
  };

  document.body.insertAdjacentHTML('beforeend', `
    <button class="blog-assistant-toggle" type="button" aria-haspopup="dialog">
      <i class="fa fa-comment-dots" aria-hidden="true"></i>
      问博客
    </button>
    <dialog class="blog-assistant" aria-labelledby="blog-assistant-title">
      <header>
        <div>
          <strong id="blog-assistant-title">问博客</strong>
          <small>仅依据本站公开文章回答</small>
        </div>
        <button class="blog-assistant-close" type="button" aria-label="关闭">×</button>
      </header>
      <div class="blog-assistant-answer" aria-live="polite">
        可以问我：钉钉同步怎么优化？水文项目踩过哪些坑？
      </div>
      <div class="blog-assistant-sources" hidden></div>
      <form class="blog-assistant-form">
        <textarea maxlength="300" rows="3" required placeholder="输入一个与博客内容相关的问题"></textarea>
        <button type="submit">发送</button>
      </form>
    </dialog>
  `);

  const dialog = document.querySelector('.blog-assistant');
  const toggle = document.querySelector('.blog-assistant-toggle');
  const close = dialog.querySelector('.blog-assistant-close');
  const form = dialog.querySelector('.blog-assistant-form');
  const input = form.querySelector('textarea');
  const submit = form.querySelector('button');
  const answer = dialog.querySelector('.blog-assistant-answer');
  const sources = dialog.querySelector('.blog-assistant-sources');

  toggle.addEventListener('click', () => {
    dialog.showModal();
    input.focus();
  });
  close.addEventListener('click', () => dialog.close());

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question) return;

    submit.disabled = true;
    answer.textContent = '正在查找相关文章…';
    sources.hidden = true;

    try {
      const context = await search(question);
      if (!context.length) {
        answer.textContent = '暂时没在博客里找到相关内容，可以换个关键词再问。';
        return;
      }

      answer.textContent = '正在整理答案…';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, context })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '请求失败');

      answer.textContent = data.answer;
      sources.replaceChildren(...context.map(item => {
        const link = document.createElement('a');
        link.href = item.url;
        link.textContent = item.title;
        return link;
      }));
      sources.hidden = false;
    } catch (error) {
      answer.textContent = error.message === '文章索引加载失败'
        ? error.message
        : '问答服务暂时不可用，请稍后再试。';
    } finally {
      submit.disabled = false;
    }
  });
})();
