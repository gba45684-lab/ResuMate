/* ResuMate free-first AI runtime.
 * Local deterministic analysis is always available. External providers are optional.
 * No developer API key is embedded here.
 */
(function (global) {
  'use strict';

  var STOP = new Set(('a an and are as at be by for from in is it of on or the to with your you our this that will can has have had not but into over under than then their they them these those was were been being about after before during through using use used'.split(/\s+/)));
  var SKILL_WORDS = ('javascript typescript react angular vue node nodejs python java kotlin swift c c++ c# sql mysql postgresql mongodb redis aws azure gcp docker kubernetes git github gitlab html css tailwind excel power bi tableau salesforce sap oracle figma photoshop canva jira scrum agile leadership management communication analytics analysis finance accounting sales marketing recruitment hr operations project management risk compliance insurance mutual funds wealth management').split(/\s+/);

  function words(text) {
    return String(text || '').toLowerCase()
      .replace(/[^a-z0-9+#.\- ]+/g, ' ')
      .split(/\s+/)
      .filter(function (w) { return w && w.length > 2 && !STOP.has(w); });
  }

  function unique(list) {
    return Array.from(new Set(list));
  }

  function textOf(resume) {
    if (typeof resume === 'string') return resume;
    if (!resume) return '';
    try { return JSON.stringify(resume); } catch (_) { return ''; }
  }

  function keywordSet(text) {
    var ws = words(text);
    var counts = {};
    ws.forEach(function (w) { counts[w] = (counts[w] || 0) + 1; });
    return Object.keys(counts)
      .sort(function (a, b) { return counts[b] - counts[a] || a.localeCompare(b); })
      .slice(0, 100);
  }

  function extractSkills(text) {
    var lower = String(text || '').toLowerCase();
    return unique(SKILL_WORDS.filter(function (skill) {
      return skill && lower.indexOf(skill) !== -1;
    }));
  }

  function matchJob(resume, jobDescription) {
    var resumeText = textOf(resume);
    var jdText = textOf(jobDescription);
    var jdWords = unique(words(jdText));
    var resumeWords = new Set(words(resumeText));
    var matched = jdWords.filter(function (w) { return resumeWords.has(w); });
    var missing = jdWords.filter(function (w) { return !resumeWords.has(w); });
    var skills = extractSkills(jdText);
    var matchedSkills = skills.filter(function (s) { return resumeWords.has(s); });
    var score = jdWords.length ? Math.round(matched.length / jdWords.length * 100) : 0;
    if (skills.length) score = Math.round(score * 0.65 + (matchedSkills.length / skills.length * 100) * 0.35);
    return {
      score: Math.max(0, Math.min(100, score)),
      matchedKeywords: matched.slice(0, 50),
      missingKeywords: missing.slice(0, 50),
      detectedSkills: skills,
      matchedSkills: matchedSkills
    };
  }

  function analyze(resume, jobDescription) {
    var text = textOf(resume);
    var lower = text.toLowerCase();
    var sections = {
      contact: /(email|phone|mobile|linkedin|address)/.test(lower),
      summary: /(summary|profile|objective)/.test(lower),
      experience: /(experience|employment|work history)/.test(lower),
      education: /(education|degree|university|college)/.test(lower),
      skills: /(skills|competencies|technical skills)/.test(lower),
      certifications: /(certification|certified|license)/.test(lower)
    };
    var sectionScore = Math.round(Object.values(sections).filter(Boolean).length / Object.keys(sections).length * 100);
    var bullets = (text.match(/[•●▪◦]|\n\s*[-*]/g) || []).length;
    var actionVerbs = (text.match(/\b(achieved|built|created|delivered|developed|designed|improved|increased|managed|led|reduced|launched|implemented|optimized|generated|automated|analyzed)\b/gi) || []).length;
    var metrics = (text.match(/\b\d+(?:\.\d+)?\s*(?:%|percent|k|m|bn|million|billion|crore|lakh|x)?\b/gi) || []).length;
    var keyword = jobDescription ? matchJob(text, jobDescription) : null;
    var impactScore = Math.min(100, Math.round((actionVerbs * 8) + (metrics * 12) + (bullets * 2)));
    var score = Math.round(sectionScore * 0.35 + impactScore * 0.25 + (keyword ? keyword.score * 0.40 : 75 * 0.40));
    var problems = [];
    Object.keys(sections).forEach(function (key) { if (!sections[key]) problems.push('Missing or unclear ' + key + ' section.'); });
    if (metrics < 2) problems.push('Add measurable results to more achievements or experience bullets.');
    if (actionVerbs < 3) problems.push('Use stronger action verbs at the start of experience bullets.');
    if (text.length < 900) problems.push('Resume content appears short; add relevant achievements and impact where truthful.');
    return {
      overallScore: Math.max(0, Math.min(100, score)),
      atsScore: Math.max(0, Math.min(100, Math.round(sectionScore * 0.5 + (keyword ? keyword.score : 75) * 0.5))),
      sectionScore: sectionScore,
      impactScore: impactScore,
      keywordScore: keyword ? keyword.score : null,
      sections: sections,
      problems: problems,
      recommendations: problems.map(function (p) { return p.replace(/^Missing or unclear /, 'Improve '); }),
      keywordMatch: keyword
    };
  }

  function rewriteBullet(bullet) {
    var original = String(bullet || '').trim();
    if (!original) return [];
    var cleaned = original.replace(/^[•●▪◦\-*]\s*/, '');
    var first = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    var hasMetric = /\d/.test(first);
    var lead = /^(managed|led|built|created|developed|designed|implemented|improved|increased|reduced|analyzed|delivered|optimized|generated|automated)\b/i.test(first);
    var suggestions = [];
    if (lead) suggestions.push(first);
    else suggestions.push('Delivered ' + first.charAt(0).toLowerCase() + first.slice(1));
    if (!hasMetric) suggestions.push(suggestions[0] + ' — add a truthful metric such as %, amount, volume, time, team size, or outcome.');
    suggestions.push('Improved ' + first.charAt(0).toLowerCase() + first.slice(1) + ' with a clear business outcome and measurable impact.');
    return unique(suggestions);
  }

  function improveSummary(summary) {
    var original = String(summary || '').trim();
    if (!original) return ['Add a 2–4 line summary covering role, strongest skills, industry/domain, and measurable value.'];
    return [
      original,
      original.replace(/\s+/g, ' ').replace(/[.]+$/, '') + '.',
      'Results-focused professional with experience in ' + extractSkills(original).slice(0, 5).join(', ') + '. ' + original
    ].filter(function (x, i, a) { return x && a.indexOf(x) === i; });
  }

  function tailor(resume, jobDescription) {
    var match = matchJob(resume, jobDescription);
    var analysis = analyze(resume, jobDescription);
    return {
      matchScore: match.score,
      matchedKeywords: match.matchedKeywords,
      missingKeywords: match.missingKeywords,
      matchedSkills: match.matchedSkills,
      suggestions: analysis.problems.concat(match.missingKeywords.slice(0, 10).map(function (k) { return 'Consider adding the keyword "' + k + '" only where it truthfully describes your experience.'; }))
    };
  }

  function interview(resume, jobDescription, count) {
    var skills = extractSkills(String(jobDescription || '') + ' ' + textOf(resume)).slice(0, 10);
    var n = Math.max(1, Math.min(Number(count) || 10, 30));
    var base = [
      'Tell me about yourself and how your experience fits this role.',
      'Which achievement on your resume are you most proud of, and why?',
      'Describe a difficult problem you solved and the measurable result.',
      'Tell me about a time you disagreed with a stakeholder and how you handled it.',
      'Why are you interested in this role?'
    ];
    skills.forEach(function (s) { if (base.length < n) base.push('How have you used ' + s + ' in a real project or business situation?'); });
    while (base.length < n) base.push('Describe a situation where you improved a process and explain the outcome.');
    return base.slice(0, n).map(function (q) { return { question: q, framework: 'Answer with Situation → Task → Action → Result (STAR). Do not invent facts.' }; });
  }

  function callProvider(provider, request) {
    if (!provider || !provider.type) return Promise.reject(new Error('No external provider configured'));
    if (!provider.apiKey) return Promise.reject(new Error('Provider API key is not configured'));
    var url = provider.endpoint;
    var headers = { 'Content-Type': 'application/json' };
    var body;
    if (provider.type === 'anthropic') {
      headers['x-api-key'] = provider.apiKey;
      headers['anthropic-version'] = '2023-06-01';
      headers['anthropic-dangerous-direct-browser-access'] = 'true';
      body = JSON.stringify({ model: provider.model || 'claude-3-5-haiku-latest', max_tokens: 1800, messages: [{ role: 'user', content: request.prompt }] });
      url = url || 'https://api.anthropic.com/v1/messages';
    } else {
      headers.Authorization = 'Bearer ' + provider.apiKey;
      body = JSON.stringify({ model: provider.model || 'free-model', messages: [{ role: 'user', content: request.prompt }] });
    }
    return fetch(url, { method: 'POST', headers: headers, body: body }).then(function (r) {
      return r.text().then(function (t) {
        if (!r.ok) throw new Error('AI provider HTTP ' + r.status);
        try { return JSON.parse(t); } catch (_) { return { raw: t }; }
      });
    });
  }

  var AI = {
    version: '1.0.0',
    analyze: analyze,
    matchJob: matchJob,
    rewriteBullet: rewriteBullet,
    improveSummary: improveSummary,
    tailor: tailor,
    interview: interview,
    extractSkills: extractSkills,
    keywords: keywordSet,
    configureProvider: function (provider) {
      try { sessionStorage.setItem('resumate.ai.provider', JSON.stringify(provider || {})); } catch (_) {}
    },
    clearProvider: function () {
      try { sessionStorage.removeItem('resumate.ai.provider'); } catch (_) {}
    },
    generate: function (request) {
      request = request || {};
      var local = request.local || 'analyze';
      if (local === 'analyze') return Promise.resolve(analyze(request.resume, request.jobDescription));
      if (local === 'tailor') return Promise.resolve(tailor(request.resume, request.jobDescription));
      if (local === 'bullet') return Promise.resolve(rewriteBullet(request.text));
      if (local === 'summary') return Promise.resolve(improveSummary(request.text));
      if (local === 'interview') return Promise.resolve(interview(request.resume, request.jobDescription, request.count));
      var provider = request.provider;
      if (!provider) {
        try { provider = JSON.parse(sessionStorage.getItem('resumate.ai.provider') || 'null'); } catch (_) {}
      }
      return callProvider(provider, request);
    }
  };

  global.ResuMateAI = AI;
  global.dispatchEvent(new CustomEvent('resumate:ai-ready', { detail: { version: AI.version, mode: 'local-first' } }));
})(window);
