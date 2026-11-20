const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 700 * 1024;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: "AI-сервис ещё не настроен: добавьте OPENAI_API_KEY в переменные окружения Vercel." });
  }

  try {
    const body = req.body || {};
    const question = String(body.question || "").trim().slice(0, 5000);
    const context = String(body.context || "").trim().slice(0, 12000);
    const category = String(body.category || "Любая ситуация").slice(0, 80);
    const style = String(body.style || "Подробно и честно").slice(0, 80);
    const persona = String(body.persona || "bunny").slice(0, 20);
    const images = Array.isArray(body.images) ? body.images : [];

    if (!question) return res.status(400).json({ error: "Напиши вопрос." });
    if (images.length > MAX_IMAGES) return res.status(400).json({ error: "Можно отправить не больше четырёх изображений." });

    const content = [{
      type: "input_text",
      text: [
        "Вопрос пользователя: " + question,
        "Категория: " + category,
        "Предпочтительный формат: " + style,
        "Дополнительный контекст и текст переписки: " + (context || "Не предоставлен."),
        "Образ MIMI: " + (persona === "sun" ? "SUN — тёплый и солнечный" : "WONY — нежный и внимательный")
      ].join("\n\n")
    }];

    for (const dataUrl of images) {
      if (typeof dataUrl !== "string" || !/^data:image\/(png|jpeg|webp|gif);base64,/.test(dataUrl)) {
        return res.status(400).json({ error: "Поддерживаются изображения PNG, JPG, WEBP и GIF." });
      }
      const approximateBytes = Math.floor((dataUrl.split(",")[1] || "").length * 0.75);
      if (approximateBytes > MAX_IMAGE_BYTES) return res.status(400).json({ error: "Каждое изображение должно быть меньше 3 МБ." });
      content.push({ type: "input_image", image_url: dataUrl, detail: "high" });
    }

    const instructions = `Ты — MIMI, внимательный и честный AI-помощник, который помогает анализировать жизненные ситуации.
Отвечай на русском. Будь тёплой, но не поддакивай и не выдавай желаемое за вероятное.
Опирайся только на предоставленные факты и явно обозначай предположения. Не придумывай проценты и статистику.
Разделяй факты, интерпретации и неизвестные обстоятельства. Не утверждай, что знаешь мысли или намерения других людей.
Если данных достаточно, дай осторожный вывод и 2-3 реалистичных сценария с объяснением факторов.
Если для содержательного вывода не хватает ключевой информации, не делай вид, что всё понятно: задай ОДИН самый полезный уточняющий вопрос в поле followup и объясни, чего именно пока нельзя заключить.
Если пользователь приложил скриншоты, прочитай видимый текст и учитывай последовательность сообщений; не выдумывай нечитаемые фрагменты.
Не делай медицинских, юридических или финансовых заключений как специалист. При признаках непосредственной опасности поставь безопасность на первое место.
Верни только корректный JSON с полями:
{"title":"короткий заголовок","summary":"основной честный вывод","reasons":["факт или аргумент 1","факт или аргумент 2"],"caveat":"что может изменить вывод или какие ограничения есть","followup":"один конкретный уточняющий вопрос или пустая строка"}.`;

    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + process.env.OPENAI_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        instructions,
        input: [{ role: "user", content }],
        text: { format: { type: "json_object" } },
        max_output_tokens: 1200,
        store: false
      })
    });

    const result = await upstream.json();
    if (!upstream.ok) {
      console.error("OpenAI API error:", result.error?.type || upstream.status);
      return res.status(502).json({ error: "AI-сервис временно не смог обработать запрос. Проверьте настройки API и попробуйте позже." });
    }

    const outputText = (result.output || [])
      .flatMap(item => item.content || [])
      .filter(item => item.type === "output_text")
      .map(item => item.text)
      .join("\n");
    if (!outputText) return res.status(502).json({ error: "AI не вернул текстовый ответ. Попробуй ещё раз." });

    let analysis;
    try { analysis = JSON.parse(outputText); }
    catch { return res.status(502).json({ error: "Не удалось разобрать ответ AI. Попробуй ещё раз." }); }

    return res.status(200).json({ analysis });
  } catch (error) {
    console.error("MIMI API error:", error?.message || "unknown");
    return res.status(500).json({ error: "Внутренняя ошибка сервера. Попробуй позже." });
  }
}
