const result = await page.evaluate(() => {
  const imgs = Array.from(document.querySelectorAll("img")).map((img) => ({
    src: img.getAttribute("src"),
    loaded: img.complete && img.naturalWidth > 0,
    w: img.naturalWidth,
    h: img.naturalHeight,
  }));
  const secs = Array.from(document.querySelectorAll("section"));
  const s1 = secs[1];
  const s2 = secs[2];
  const s3 = secs[3];
  const count = (root, sel) => root.querySelectorAll(sel).length;
  const texts = (root) => root.innerText.slice(0, 400);
  return {
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    svgCount: document.querySelectorAll("svg").length,
    screen2: {
      cards: count(s1, ".grid > div"),
      imgs: Array.from(s1.querySelectorAll("img")).map((i) => i.getAttribute("src")),
      funnelText: Array.from(s1.querySelectorAll("svg text")).map((t) => t.textContent),
      hasTitle: s1.innerText.includes("销售培训的几个痛点"),
      hasCta: s1.innerText.includes("看看 Graspit 如何解决"),
    },
    screen3: {
      img: Array.from(s2.querySelectorAll("img")).map((i) => i.getAttribute("src")),
      hasDialogue: s2.innerText.includes("不降价，我们就先这样"),
      hasDiagnosis: s2.innerText.includes("AI 诊断"),
      hasAction: s2.innerText.includes("明确改进动作"),
      hasChart: s2.innerText.includes("训练前后，能力维度对比"),
    },
    screen4: {
      img: Array.from(s3.querySelectorAll("img")).map((i) => i.getAttribute("src")),
      loopNodes: s3.querySelectorAll("svg text").length,
      hasLoopTitle: s3.innerText.includes("闭环如何运转"),
      steps: Array.from(s3.querySelectorAll("h3")).map((h) => h.textContent),
      hasTrend: s3.innerText.includes("三轮训练后的得分变化"),
    },
    images: imgs,
  };
});
return result;
