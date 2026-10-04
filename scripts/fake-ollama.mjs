// Fake Ollama server for development tests: answers with the right JSON shapes so the
// translation pipeline can be exercised end to end without a real model.
import http from "node:http";
http
  .createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: "fake:latest" }] }));
      const j = JSON.parse(body);
      const props = Object.keys(j.format?.properties ?? {});
      const user = j.messages.at(-1).content;
      let out;
      if (props.includes("translations")) {
        const arr = JSON.parse(user.slice(user.indexOf("[")));
        out = { translations: arr.map((s) => ({ i: s.i, fr: `[FR] ${s.text}` })) };
      } else if (props.includes("terms")) {
        out = { terms: [{ term: "world action model", keep: true, fr: "world action model", definition: "Un modèle qui prédit à la fois les actions du robot et l'état futur de la scène." }, { term: "manipulation", keep: false, fr: "manipulation", definition: "Saisir et déplacer des objets." }] };
      } else if (props.includes("items")) {
        const arr = JSON.parse(user);
        out = { items: arr.map((a) => ({ id: a.id, title_fr: `[FR] ${a.title}`, teaser_fr: "Accroche de test en français." })) };
      } else if (props.includes("explanation")) out = { explanation: "Explication de test." };
      else if (props.includes("interests")) out = { interests: [{ label: "Régulation des émotions", keywords: ["emotion regulation", "affect"] }] };
      else out = { reply: "Bonjour, prêt." };
      res.end(JSON.stringify({ message: { content: JSON.stringify(out) }, done_reason: "stop" }));
    });
  })
  .listen(11434, "127.0.0.1", () => console.log("fake ollama on 11434"));
