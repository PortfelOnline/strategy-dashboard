import { invokeLLM } from "../_core/llm";

export const PRIORITY_PAGES = [
  { url: "/kadastr/raspolozhenie-po-kadastrovomu-nomeru/",             anchor: "найти участок по кадастровому номеру" },
  { url: "/kadastr/kadastrovyj-nomer-po-adresu-obekta-nedvizhimosti/", anchor: "кадастровый номер по адресу" },
  { url: "/kadastr/proverit-kvartiru-v-rosreestre-po-adresu-onlajn/",  anchor: "проверить квартиру в росреестре" },
  { url: "/kadastr/poluchit-vypisku-egrn-po-kadastrovomu-nomeru/",     anchor: "получить выписку ЕГРН" },
  { url: "/kadastr/proverit-obremenenie-na-nedvizhimost/",             anchor: "проверить обременение на недвижимость" },
] as const;

type PageEntry = typeof PRIORITY_PAGES[number];

export function pickNextPage(existingCount: number): PageEntry {
  return PRIORITY_PAGES[existingCount % PRIORITY_PAGES.length];
}

function topicForUrl(url: string): string {
  const MAP: Record<string, string> = {
    "/kadastr/raspolozhenie-po-kadastrovomu-nomeru/":             "Как найти расположение земельного участка по кадастровому номеру",
    "/kadastr/kadastrovyj-nomer-po-adresu-obekta-nedvizhimosti/": "Как узнать кадастровый номер объекта недвижимости по адресу",
    "/kadastr/proverit-kvartiru-v-rosreestre-po-adresu-onlajn/":  "Как проверить квартиру в росреестре по адресу онлайн",
    "/kadastr/poluchit-vypisku-egrn-po-kadastrovomu-nomeru/":     "Как получить выписку из ЕГРН по кадастровому номеру",
    "/kadastr/proverit-obremenenie-na-nedvizhimost/":             "Как проверить обременение на недвижимость онлайн",
  };
  return MAP[url] ?? "Кадастровая информация по недвижимости";
}

function questionForUrl(url: string): string {
  const MAP: Record<string, string> = {
    "/kadastr/raspolozhenie-po-kadastrovomu-nomeru/":             "Как найти участок по кадастровому номеру?",
    "/kadastr/kadastrovyj-nomer-po-adresu-obekta-nedvizhimosti/": "Как узнать кадастровый номер квартиры по адресу?",
    "/kadastr/proverit-kvartiru-v-rosreestre-po-adresu-onlajn/":  "Как проверить квартиру через Росреестр онлайн?",
    "/kadastr/poluchit-vypisku-egrn-po-kadastrovomu-nomeru/":     "Где получить выписку из ЕГРН быстро?",
    "/kadastr/proverit-obremenenie-na-nedvizhimost/":             "Как узнать есть ли обременение на недвижимость?",
  };
  return MAP[url] ?? "Как проверить недвижимость онлайн?";
}

async function callLLM(system: string, user: string): Promise<string> {
  const resp = await invokeLLM({
    model:     "llama-3.3-70b-versatile",
    maxTokens: 3000,
    messages:  [{ role: "system", content: system }, { role: "user", content: user }],
  });
  const content = resp.choices[0]?.message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c: any) => c.text ?? "").join("");
  return "";
}

function parseJson(raw: string): any {
  try { return JSON.parse(raw.replace(/^```json\s*|\s*```$/g, "").trim()); } catch { return null; }
}

export async function generateDzenArticle(targetUrl: string, anchor: string): Promise<{ title: string; article: string }> {
  const link  = `[${anchor}](https://kadastrmap.info${targetUrl})`;
  const topic = topicForUrl(targetUrl);
  const system = `Ты SEO-автор, пишешь полезные статьи о недвижимости и кадастре для Яндекс Дзен. Стиль: объясняю как эксперт, без воды. Структура: заголовок, 4-6 разделов H2, вывод. Вставь ссылку ${link} органично в тело текста (не в конце). Только русский язык. Без markdown-кодов и HTML.`;
  const user   = `Напиши статью на тему "${topic}". Объём 900-1200 слов. Верни JSON: {"title":"...","article":"..."}`;
  const raw    = await callLLM(system, user);
  const json   = parseJson(raw);
  return { title: json?.title ?? topic, article: json?.article ?? raw };
}

export async function generateSparkArticle(targetUrl: string, anchor: string): Promise<{ title: string; article: string }> {
  const link  = `[${anchor}](https://kadastrmap.info${targetUrl})`;
  const topic = topicForUrl(targetUrl);
  const system = `Ты эксперт по недвижимости, пишешь экспертную колонку на Spark.ru. Деловой практический стиль, минимум списков, больше объяснений. Вставь ссылку ${link} органично. Только русский язык.`;
  const user   = `Напиши экспертную колонку "${topic}". Объём 600-900 слов. Верни JSON: {"title":"...","article":"..."}`;
  const raw    = await callLLM(system, user);
  const json   = parseJson(raw);
  return { title: json?.title ?? topic, article: json?.article ?? raw };
}

export async function generateKwAnswer(targetUrl: string, _anchor: string): Promise<{ question: string; article: string }> {
  const link     = `https://kadastrmap.info${targetUrl}`;
  const question = questionForUrl(targetUrl);
  const system   = `Ты эксперт по кадастру, отвечаешь на вопросы на Яндекс.Кью. Дай развёрнутый практический ответ. Упомяни ${link} органично. Только русский язык.`;
  const user     = `Напиши ответ на вопрос "${question}". Объём 200-350 слов. Верни JSON: {"answer":"..."}`;
  const raw      = await callLLM(system, user);
  const json     = parseJson(raw);
  return { question, article: json?.answer ?? raw };
}
