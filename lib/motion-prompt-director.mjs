import sharp from 'sharp';

const MOTION_PROMPT_MAX_CHARS = 2600;

export function cleanMotionDirectorPrompt(text = '') {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[a-z]*|```/gi, ''))
    .replace(/^(final\s+)?(english\s+)?(video\s+)?prompt\s*:\s*/i, '')
    .replace(/^[`"'“”]+|[`"'“”]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MOTION_PROMPT_MAX_CHARS);
}

function timingPlan(count, durationSeconds = 8) {
  const duration = Math.max(1, Number(durationSeconds || 8));
  const end = duration.toFixed(1);
  if (count >= 3) {
    const cut1 = (duration * 0.33).toFixed(1);
    const shot2Start = Math.min(duration - 0.2, duration * 0.33 + 0.2).toFixed(1);
    const cut2 = (duration * 0.66).toFixed(1);
    const shot3Start = Math.min(duration - 0.1, duration * 0.66 + 0.2).toFixed(1);
    return {
      duration,
      structure: `A crisp ${duration}-second cinematic wedding film with exactly three hard-cut shots and no people. SHOT 1 (0.0-${cut1}s, [referencing image 1])... HARD CUT. SHOT 2 (${shot2Start}-${cut2}s, [referencing image 2])... HARD CUT. SHOT 3 (${shot3Start}-${end}s, [referencing image 3])... Consistent professional wedding film style.`,
      allocation: `For a ${duration}-second video, explicitly allocate time: Image 1 is clearly visible for 0.0-${cut1}s, Image 2 is clearly visible for ${shot2Start}-${cut2}s, and Image 3 is clearly visible for ${shot3Start}-${end}s. Each referenced image must become a distinct readable shot with its own camera scale.`,
      guard: `HIGH PRIORITY SHOT PLAN: create exactly three separate readable shots in a ${duration}-second video, not one continuous dolly and not a two-shot video. Shot 1 is 0.0-${cut1}s and must stay at Image 1 composition and camera scale with only micro camera motion. Shot 2 is ${shot2Start}-${cut2}s and must stay at Image 2 composition and camera scale as a distinct middle shot, with no macro flowers or Image 3 foreground subject. Shot 3 is ${shot3Start}-${end}s and only then may show Image 3 composition and close-up subject. Use direct hard cuts only: no fades, dissolves, defocus transitions, focus blooms, light blooms, prolonged blur, or invented scenes.`,
    };
  }
  if (count === 2) {
    const firstEnd = Math.max(0.1, duration / 2 - 0.1).toFixed(1);
    const cut = (duration / 2).toFixed(1);
    const secondStart = Math.min(duration - 0.1, duration / 2 + 0.1).toFixed(1);
    return {
      duration,
      structure: `A crisp ${duration}-second cinematic wedding film with exactly two hard-cut shots and no people. SHOT 1 (0.0-${firstEnd}s, [referencing image 1])... HARD CUT at ${cut}s. SHOT 2 (${secondStart}-${end}s, [referencing image 2])... Consistent professional wedding film style.`,
      allocation: `For a ${duration}-second video, explicitly allocate time: Image 1 is clearly visible for about 0.0-${firstEnd}s, then an instant editorial match cut under 0.2s, and Image 2 is clearly visible for about ${secondStart}-${end}s.`,
      guard: `Accuracy guard: timing must be Image 1 from 0.0-${firstEnd}s, an instant editorial match cut under 0.2s, and Image 2 from ${secondStart}-${end}s; keep Image 1 and Image 2 as two distinct readable shots; do not show Image 2-only objects before the transition; transitions must be quick cuts only, never slow fades, dissolves, defocus transitions, focus blooms, light blooms, or prolonged blur.`,
    };
  }
  return {
    duration,
    structure: `A crisp ${duration}-second cinematic wedding film with no people. SHOT 1 (0.0-${end}s, [referencing image 1])... Consistent professional wedding film style.`,
    allocation: `For a ${duration}-second video, stay in Image 1 for the whole video with one continuous camera move.`,
    guard: 'Accuracy guard: stay within Image 1 only and do not invent unrelated objects or later scenes.',
  };
}

function appendMotionTimingGuards(prompt, count, durationSeconds = 8) {
  const guard = timingPlan(count, durationSeconds).guard;
  const normalized = String(prompt || '').trim();
  if (!normalized) return guard;
  if (/Accuracy guard:/i.test(normalized)) return normalized.slice(0, MOTION_PROMPT_MAX_CHARS);
  if (/HIGH PRIORITY SHOT PLAN:/i.test(normalized)) return normalized.slice(0, MOTION_PROMPT_MAX_CHARS);
  return `${guard} ${normalized}`.replace(/\s+/g, ' ').trim().slice(0, MOTION_PROMPT_MAX_CHARS);
}

function forceFastTransitionLanguage(prompt) {
  return String(prompt || '')
    .replace(/\bA seamless cinematic wedding sequence transitioning\b/i, 'A crisp cinematic wedding sequence cutting')
    .replace(/\bseamless cinematic wedding sequence\b/gi, 'crisp cinematic wedding sequence')
    .replace(/\btransitioning through\b/gi, 'cutting through')
    .replace(/\b(?:beautiful|smooth|soft|slow|elegant|brief|quick)?\s*(?:bokeh\s+defocus|defocus|focus\s+bloom|light-bloom|light\s+bloom|optical)\s+transition\b/gi, 'instant editorial match cut')
    .replace(/\b(?:smoothly|elegantly)\s+(?:fades?|dissolves?|transitions?)\b/gi, 'cuts')
    .replace(/\b(?:fade|dissolve)\s+(?:into|to)\b/gi, 'cut to')
    .replace(/\bprolonged\s+blur\b/gi, 'crisp cut')
    .replace(/\bslow\s+push\s+forward\b/gi, 'subtle micro push while preserving the uploaded composition')
    .replace(/\bpush\s+forward\b/gi, 'micro push while preserving the uploaded composition')
    .replace(/\btracking\s+shot\b/gi, 'subtle parallax shot')
    .replace(/\s+/g, ' ')
    .trim();
}

async function imageBufferToPromptPart(buffer, label, maxEdge, quality) {
  const image = await sharp(buffer)
    .rotate()
    .resize(maxEdge, maxEdge, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality })
    .toBuffer();

  return [
    { type: 'text', text: label },
    {
      type: 'image_url',
      image_url: {
        url: `data:image/jpeg;base64,${image.toString('base64')}`,
        detail: 'high',
      },
    },
  ];
}

export async function buildMotionDirectorPrompt({
  sourceImages = [],
  endpoint = '',
  apiKey = '',
  model = '',
  durationSeconds = 8,
  maxReferences = 3,
  timeoutMs = 60_000,
  maxTokens = 4000,
  visionMaxEdge = 768,
  visionImageQuality = 70,
  fetchImpl = fetch,
} = {}) {
  const references = sourceImages.filter((buffer) => buffer?.length).slice(0, Math.max(1, Number(maxReferences || 3)));
  if (!references.length) throw new Error('No reference images supplied');
  if (!endpoint || !apiKey || !model) throw new Error('Gemini prompt model is not configured');

  const count = references.length;
  const plan = timingPlan(count, durationSeconds);
  const sceneText = count >= 3 ? 'three scenes' : count === 2 ? 'two scenes' : 'one scene';
  const imageParts = [];
  for (const [index, buffer] of references.entries()) {
    const label = index === 0
      ? 'Image 1: opening scene / establishing wedding view.'
      : index === 1
      ? 'Image 2: middle scene / local detail, aisle, lantern, guest-area, or transition bridge.'
      : 'Image 3: final scene / ending frame. Preserve its real subject and camera angle.';
    imageParts.push(...await imageBufferToPromptPart(buffer, label, visionMaxEdge, visionImageQuality));
  }

  const body = {
    model,
    temperature: 0.35,
    max_tokens: maxTokens,
    messages: [
      {
        role: 'system',
        content: [
          'You are a wedding film prompt director for Veo image-to-video generation.',
          'Write concise cinematic English prompts, not analysis.',
          'Output only one final prompt paragraph. No markdown, no bullet points, no explanations.',
        ].join(' '),
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: [
              `Look at the ${count} uploaded wedding reference image${count > 1 ? 's' : ''} in order.`,
              `Write one concise English video prompt for Veo that transitions through ${sceneText}.`,
              count >= 3
                ? 'The video must go through Image 1, Image 2, and Image 3 in that exact order.'
                : count === 2
                ? 'The video must go from Image 1 to Image 2 in that exact order.'
                : 'The video must stay within Image 1 as the only scene.',
              count >= 3
                ? `Use this exact structure: "${plan.structure}"`
                : count === 2
                ? `Use this exact structure: "${plan.structure}"`
                : `Use this structure: "${plan.structure}"`,
              plan.allocation,
              count >= 3
                ? 'Keep segment objects isolated by time: elements unique to Image 3 must not appear before 6.7s, and Image 2 must not be skipped or merged into Image 1. Do not copy the final detail object into Shot 1 or Shot 2.'
                : count === 2
                ? 'Keep segment objects isolated by time: elements unique to Image 2 must not appear before the transition.'
                : 'Do not introduce objects from imagined later scenes.',
              'Adapt the visual details to the uploaded images instead of copying generic wedding objects.',
              'Use only colors and object types that are clearly visible in the references. Do not say gold/golden unless metallic gold decor is actually visible; yellow flowers are yellow, not gold. Do not say chandelier unless a conventional chandelier is visible; for ceiling bead curtains or hanging crystal strands, describe them as crystal strands, crystal cascades, or ceiling installations.',
              'If the references use a black or dark venue background, describe the look as controlled spotlighting or stage lighting with clear subject visibility. Do not ask for darker lighting or underexposed footage.',
              'Mention only subtle camera motion inside each shot, such as micro push, slight pan, or gentle parallax while preserving that uploaded image composition. Do not describe a continuous walk, dolly, or push from Image 1 into Image 2, because Image 2 must begin as its own hard-cut shot.',
              'Do not use bokeh defocus transition, focus bloom, light-bloom transition, long fades, fade to black, fade to white, prolonged blur, slow dissolve, or extended transition wording. Transitions are instant cuts, not separate shots.',
              'Keep no people, consistent lighting, same wedding style, same colors, same decorations, elegant atmosphere, fluid camera motions, professional wedding film style.',
              'Do not invent a new wedding scene unrelated to the references.',
              'Keep the prompt about 120-170 words.',
              count >= 3
                ? 'Include lightweight markers [referencing image 1], [referencing image 2], and [referencing image 3].'
                : count === 2
                ? 'Include lightweight markers [referencing image 1] and [referencing image 2].'
                : 'Include [referencing image 1].',
            ].join(' '),
          },
          ...imageParts,
        ],
      },
    ],
  };

  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const raw = await response.text();
  let payload = null;
  try { payload = raw ? JSON.parse(raw) : null; } catch {}
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || raw || `HTTP ${response.status}`;
    throw new Error(String(message).replace(/\s+/g, ' ').slice(0, 240));
  }

  const content = payload?.choices?.[0]?.message?.content || payload?.output_text || payload?.content || '';
  const prompt = forceFastTransitionLanguage(cleanMotionDirectorPrompt(content));
  if (!prompt) throw new Error('Gemini returned an empty motion prompt');
  return appendMotionTimingGuards(prompt, count, durationSeconds);
}
