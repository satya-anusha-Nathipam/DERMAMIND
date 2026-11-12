/* ========================================
   DERMAMIND - Multilingual Voice Assistant
   Feature 11
   Frontend-only browser SpeechSynthesis + SpeechRecognition.
   ======================================== */

(function () {
  'use strict';

  const ASSISTANT_TEXT = {
    en: {
      title: '🗣️ Voice Assistant',
      subtitle: 'Ask about your scan in English, Telugu, or Hindi.',
      placeholder: 'Ask a question…',
      language: 'Language',
      send: 'Send',
      speak: '🔊 Speak',
      stop: '⏹ Stop Speaking',
      mic: '🎙️',
      disclaimer: '⚠️ Disclaimer: Dermamind provides AI screening support only. It cannot diagnose skin cancer or replace a dermatologist. A prediction is not a confirmed diagnosis. Please seek professional medical advice for a concerning, changing, bleeding, painful, or persistent skin lesion.',
      ready: 'Ready',
      listening: 'Listening… speak now.',
      speaking: 'Speaking…',
      micUnsupported: 'Voice input is not supported by this browser. You can type your question instead.',
      micDenied: 'Microphone permission was denied. You can type your question instead.',
      noSpeech: 'No speech was detected. Please try again or type your question.',
      speechError: 'Voice input could not be completed. Please try again or type your question.',
      noResult: 'Please complete a scan first. Then I can explain the current analysis without inventing any result.',
      upload: 'To upload an image, use the image upload area above, choose a clear close-up skin or lesion image, wait for the image check to finish, and then select Scan. The image should be suitable before the AI analysis starts.',
      prediction: d => d ? `Your current AI prediction is "${d.topClass || 'Unknown'}". This is the model's top predicted lesion category for the uploaded image. It is a screening result only, not a confirmed diagnosis.` : null,
      confidence: d => d ? `The current model confidence is ${safe(d.confidence)}%. This is the probability assigned to the top predicted class by the model. It shows how strongly the model favored that class; it does not mean that the result is ${safe(d.confidence)}% medically certain.` : null,
      suitability: d => {
        if (!d) return null;
        const status = String(d.imageQualityStatus || '').toLowerCase();
        if (status === 'good') return `The image quality check says the image looks good for analysis. ${d.imageValidationMessage || ''}`.trim();
        if (status === 'poor') return `The image quality check marked this image as poor. ${d.imageValidationMessage || 'A clearer, close-up image may give the model a better input.'} Please treat the screening result cautiously.`.trim();
        if (status === 'invalid') return `The image was marked as unsuitable for analysis. ${d.imageValidationMessage || 'Please upload a clear, supported image of the skin area or lesion.'}`;
        return 'The image suitability status is not available in the current analysis.';
      },
      heatmap: d => {
        const ready = !!window.__dermaMindXaiReady;
        if (ready) return 'The heatmap is an explainable-AI view. The highlighted regions show image areas that contributed to the model prediction. They are not proof of cancer and should not be interpreted as a medical diagnosis.';
        return 'The XAI heatmap is still being generated or is unavailable for this scan. When available, highlighted regions will show image areas that contributed to the model prediction. They are not proof of cancer.';
      },
      next: d => {
        if (!d) return 'After uploading an image, review the AI screening result and image quality message. If the lesion is changing, bleeding, painful, persistent, or concerning, arrange a professional medical evaluation.';
        const concerning = ['high', 'medium'].includes(String(d.riskClass || '').toLowerCase());
        return concerning
          ? `The current screening is marked "${d.risk || 'concerning'}". Do not treat this as a confirmed diagnosis. The safest next step is to arrange prompt evaluation by a dermatologist, especially if the lesion is changing, bleeding, painful, or persistent.`
          : `The current screening is marked "${d.risk || 'Low Risk'}". Continue to monitor the area and seek professional medical advice if it changes, bleeds, becomes painful, persists, or otherwise concerns you.`;
      },
      explanation: d => d ? `The existing analysis explanation says: ${d.explanation || 'No explanation is available.'}` : null,
      generic: d => d
        ? `I can explain the current scan. The top prediction is "${d.topClass || 'Unknown'}" with ${safe(d.confidence)}% model confidence. The image quality status is "${formatStatus(d.imageQualityStatus)}". Remember that this is AI screening, not a confirmed diagnosis. You can ask me about the prediction, confidence, image suitability, heatmap, highlighted regions, or next steps.`
        : 'Please complete a scan first. I can then explain the current result using the values already shown in Dermamind.',
      medical: 'A professional medical consultation may be recommended because an AI image classifier can make mistakes and cannot assess your full medical history, physical examination, symptoms, or changes over time. A dermatologist can evaluate the lesion in context and decide whether further examination is needed.'
    },
    te: {
      title: '🗣️ వాయిస్ అసిస్టెంట్',
      subtitle: 'మీ స్కాన్ గురించి తెలుగు, English లేదా हिंदीలో అడగండి.',
      placeholder: 'ప్రశ్న అడగండి…',
      language: 'భాష',
      send: 'పంపండి',
      speak: '🔊 వినిపించు',
      stop: '⏹ వినిపించడం ఆపు',
      mic: '🎙️',
      disclaimer: '⚠️ గమనిక: Dermamind కేవలం AI స్క్రీనింగ్ సహాయం మాత్రమే అందిస్తుంది. ఇది చర్మ క్యాన్సర్‌ను నిర్ధారించదు మరియు డెర్మటాలజిస్ట్‌ను భర్తీ చేయదు. AI అంచనా ఖచ్చితమైన వైద్య నిర్ధారణ కాదు. చర్మంపై మార్పు, రక్తస్రావం, నొప్పి, ఎక్కువకాలం కొనసాగడం లేదా ఆందోళన కలిగించే లక్షణాలు ఉంటే వైద్య నిపుణుడిని సంప్రదించండి.',
      ready: 'సిద్ధంగా ఉంది',
      listening: 'వింటున్నాను… ఇప్పుడు మాట్లాడండి.',
      speaking: 'వినిపిస్తోంది…',
      micUnsupported: 'ఈ బ్రౌజర్‌లో వాయిస్ ఇన్‌పుట్‌కు మద్దతు లేదు. మీరు ప్రశ్నను టైప్ చేయవచ్చు.',
      micDenied: 'మైక్రోఫోన్ అనుమతి ఇవ్వబడలేదు. మీరు ప్రశ్నను టైప్ చేయవచ్చు.',
      noSpeech: 'మాట్లాడినది గుర్తించబడలేదు. మళ్లీ ప్రయత్నించండి లేదా ప్రశ్నను టైప్ చేయండి.',
      speechError: 'వాయిస్ ఇన్‌పుట్ పూర్తి కాలేదు. మళ్లీ ప్రయత్నించండి లేదా ప్రశ్నను టైప్ చేయండి.',
      noResult: 'ముందుగా స్కాన్ పూర్తి చేయండి. ఆ తర్వాత ప్రస్తుత విశ్లేషణలో ఉన్న సమాచారంతో నేను వివరిస్తాను; కొత్త ఫలితాలను ఊహించను.',
      upload: 'చిత్రాన్ని అప్‌లోడ్ చేయడానికి పై భాగంలోని image upload ప్రాంతాన్ని ఉపయోగించండి. చర్మం లేదా lesion యొక్క స్పష్టమైన close-up చిత్రాన్ని ఎంచుకోండి. Image check పూర్తయ్యే వరకు వేచి ఉండి, తర్వాత Scan ఎంచుకోండి. AI analysis ప్రారంభమయ్యే ముందు చిత్రం సరిపోతుందని నిర్ధారించాలి.',
      prediction: d => d ? `ప్రస్తుత AI prediction "${d.topClass || 'Unknown'}". ఇది అప్‌లోడ్ చేసిన చిత్రానికి మోడల్ ఇచ్చిన top predicted lesion category. ఇది screening result మాత్రమే; ఖచ్చితమైన వైద్య నిర్ధారణ కాదు.` : null,
      confidence: d => d ? `ప్రస్తుత model confidence ${safe(d.confidence)}%. ఇది మోడల్ top predicted class‌కు ఇచ్చిన probability. మోడల్ ఆ class‌ను ఎంత బలంగా ఎంచుకుందో ఇది చూపిస్తుంది; ఇది వైద్యపరంగా ${safe(d.confidence)}% ఖచ్చితత్వం అని అర్థం కాదు.` : null,
      suitability: d => {
        if (!d) return null;
        const status = String(d.imageQualityStatus || '').toLowerCase();
        if (status === 'good') return `Image quality check ప్రకారం చిత్రం analysis‌కు సరిపోతుంది. ${d.imageValidationMessage || ''}`.trim();
        if (status === 'poor') return `Image quality check ఈ చిత్రాన్ని poorగా గుర్తించింది. ${d.imageValidationMessage || 'మరింత స్పష్టమైన close-up చిత్రం ఉపయోగించడం మంచిది.'} కాబట్టి screening result‌ను జాగ్రత్తగా చూడండి.`.trim();
        if (status === 'invalid') return `ఈ చిత్రం analysis‌కు సరిపోదని గుర్తించబడింది. ${d.imageValidationMessage || 'చర్మం లేదా lesion యొక్క స్పష్టమైన supported image‌ను అప్‌లోడ్ చేయండి.'}`;
        return 'ప్రస్తుత analysis‌లో image suitability status అందుబాటులో లేదు.';
      },
      heatmap: () => window.__dermaMindXaiReady
        ? 'Heatmap అనేది Explainable AI view. Highlight చేసిన ప్రాంతాలు model prediction‌కు సహకరించిన image areas‌ను చూపిస్తాయి. అవి cancer‌కు proof కావు మరియు medical diagnosis‌గా అర్థం చేసుకోకూడదు.'
        : 'ఈ scan కోసం XAI heatmap ఇంకా తయారవుతోంది లేదా అందుబాటులో లేదు. అందుబాటులోకి వచ్చినప్పుడు highlighted regions model prediction‌కు సహకరించిన image areas‌ను చూపిస్తాయి. అవి cancer‌కు proof కావు.',
      next: d => {
        if (!d) return 'Image upload చేసిన తర్వాత AI screening result మరియు image quality message చూడండి. Lesion మారుతుంటే, రక్తస్రావం ఉంటే, నొప్పిగా ఉంటే, ఎక్కువకాలం ఉంటే లేదా ఆందోళన కలిగిస్తే dermatologist‌ను సంప్రదించండి.';
        const concerning = ['high', 'medium'].includes(String(d.riskClass || '').toLowerCase());
        return concerning
          ? `ప్రస్తుత screening "${d.risk || 'concerning'}"గా ఉంది. దీన్ని ఖచ్చితమైన diagnosis‌గా భావించవద్దు. ముఖ్యంగా lesion మారుతుంటే, రక్తస్రావం లేదా నొప్పి ఉంటే dermatologist‌ను త్వరగా సంప్రదించడం మంచిది.`
          : `ప్రస్తుత screening "${d.risk || 'Low Risk'}"గా ఉంది. ప్రాంతాన్ని గమనిస్తూ ఉండండి. మార్పు, రక్తస్రావం, నొప్పి లేదా ఎక్కువకాలం కొనసాగడం ఉంటే వైద్య నిపుణుడిని సంప్రదించండి.`;
      },
      explanation: d => d ? `ఇప్పటికే ఉన్న analysis explanation: ${d.explanation || 'Explanation అందుబాటులో లేదు.'}` : null,
      generic: d => d
        ? `ప్రస్తుత scan గురించి నేను వివరించగలను. Top prediction "${d.topClass || 'Unknown'}", model confidence ${safe(d.confidence)}%. Image quality status "${formatStatus(d.imageQualityStatus)}". ఇది AI screening మాత్రమే, ఖచ్చితమైన diagnosis కాదు. Prediction, confidence, image suitability, heatmap, highlighted regions లేదా next steps గురించి అడగండి.`
        : 'ముందుగా scan పూర్తి చేయండి. ఆ తర్వాత Dermamind‌లో ఇప్పటికే ఉన్న ప్రస్తుత result ఆధారంగా నేను వివరిస్తాను.',
      medical: 'Professional medical consultation సిఫారసు చేయవచ్చు, ఎందుకంటే AI image classifier తప్పులు చేయవచ్చు మరియు మీ పూర్తి medical history, physical examination, symptoms లేదా కాలక్రమంలో వచ్చిన మార్పులను అంచనా వేయదు. Dermatologist lesion‌ను పూర్తి సందర్భంలో పరిశీలించి, మరింత పరీక్ష అవసరమా నిర్ణయించగలరు.'
    },
    hi: {
      title: '🗣️ वॉइस असिस्टेंट',
      subtitle: 'अपने स्कैन के बारे में हिंदी, English या తెలుగు में पूछें।',
      placeholder: 'प्रश्न पूछें…',
      language: 'भाषा',
      send: 'भेजें',
      speak: '🔊 बोलकर सुनाएँ',
      stop: '⏹ बोलना बंद करें',
      mic: '🎙️',
      disclaimer: '⚠️ महत्वपूर्ण: Dermamind केवल AI स्क्रीनिंग सहायता देता है। यह त्वचा के कैंसर का निदान नहीं कर सकता और dermatologist की जगह नहीं लेता। AI prediction पक्की medical diagnosis नहीं है। यदि त्वचा का घाव बदल रहा है, खून आ रहा है, दर्द हो रहा है, लंबे समय से बना हुआ है या चिंता पैदा कर रहा है, तो medical professional से सलाह लें।',
      ready: 'तैयार',
      listening: 'सुन रहा हूँ… अब बोलें।',
      speaking: 'बोल रहा हूँ…',
      micUnsupported: 'इस browser में voice input उपलब्ध नहीं है। आप अपना प्रश्न टाइप कर सकते हैं।',
      micDenied: 'Microphone permission नहीं मिली। आप अपना प्रश्न टाइप कर सकते हैं।',
      noSpeech: 'कोई आवाज़ पहचानी नहीं गई। फिर से कोशिश करें या प्रश्न टाइप करें।',
      speechError: 'Voice input पूरा नहीं हो सका। फिर से कोशिश करें या प्रश्न टाइप करें।',
      noResult: 'पहले scan पूरा करें। उसके बाद मैं वर्तमान analysis को बिना कोई नया result बनाए समझा सकता हूँ।',
      upload: 'Image upload करने के लिए ऊपर दिए image upload area का उपयोग करें। त्वचा या lesion की साफ़ close-up image चुनें, image check पूरा होने दें और फिर Scan चुनें। AI analysis शुरू होने से पहले image suitable होनी चाहिए।',
      prediction: d => d ? `आपकी वर्तमान AI prediction "${d.topClass || 'Unknown'}" है। यह uploaded image के लिए model की top predicted lesion category है। यह केवल screening result है, पक्की medical diagnosis नहीं।` : null,
      confidence: d => d ? `वर्तमान model confidence ${safe(d.confidence)}% है। यह top predicted class को model द्वारा दी गई probability है। यह बताती है कि model ने उस class को कितना मजबूत माना; इसका मतलब यह नहीं कि medical result ${safe(d.confidence)}% निश्चित है।` : null,
      suitability: d => {
        if (!d) return null;
        const status = String(d.imageQualityStatus || '').toLowerCase();
        if (status === 'good') return `Image quality check के अनुसार image analysis के लिए अच्छी है। ${d.imageValidationMessage || ''}`.trim();
        if (status === 'poor') return `Image quality check ने image को poor बताया है। ${d.imageValidationMessage || 'एक अधिक साफ़ close-up image बेहतर input दे सकती है।'} इसलिए screening result को सावधानी से देखें।`.trim();
        if (status === 'invalid') return `Image analysis के लिए suitable नहीं है। ${d.imageValidationMessage || 'त्वचा या lesion की साफ़, supported image upload करें।'}`;
        return 'वर्तमान analysis में image suitability status उपलब्ध नहीं है।';
      },
      heatmap: () => window.__dermaMindXaiReady
        ? 'Heatmap Explainable AI view है। Highlight किए गए हिस्से वे image areas हैं जिन्होंने model prediction में योगदान दिया। वे cancer का proof नहीं हैं और medical diagnosis नहीं माने जाने चाहिए।'
        : 'इस scan का XAI heatmap अभी बन रहा है या उपलब्ध नहीं है। उपलब्ध होने पर highlighted regions वे image areas दिखाएँगे जिन्होंने model prediction में योगदान दिया। वे cancer का proof नहीं हैं।',
      next: d => {
        if (!d) return 'Image upload करने के बाद AI screening result और image quality message देखें। यदि lesion बदल रहा है, खून आ रहा है, दर्द है, लंबे समय से है या चिंता पैदा करता है, तो dermatologist से सलाह लें।';
        const concerning = ['high', 'medium'].includes(String(d.riskClass || '').toLowerCase());
        return concerning
          ? `वर्तमान screening "${d.risk || 'concerning'}" है। इसे पक्की diagnosis न मानें। खासकर यदि lesion बदल रहा है, खून आ रहा है या दर्द है, तो dermatologist से जल्द evaluation कराना उचित है।`
          : `वर्तमान screening "${d.risk || 'Low Risk'}" है। फिर भी उस जगह पर नज़र रखें और यदि बदलाव, खून, दर्द या लगातार समस्या हो तो medical professional से सलाह लें।`;
      },
      explanation: d => d ? `मौजूदा analysis explanation: ${d.explanation || 'Explanation उपलब्ध नहीं है।'}` : null,
      generic: d => d
        ? `मैं वर्तमान scan समझा सकता हूँ। Top prediction "${d.topClass || 'Unknown'}" है और model confidence ${safe(d.confidence)}% है। Image quality status "${formatStatus(d.imageQualityStatus)}" है। यह AI screening है, पक्की diagnosis नहीं। Prediction, confidence, image suitability, heatmap, highlighted regions या next steps के बारे में पूछें।`
        : 'पहले scan पूरा करें। उसके बाद मैं Dermamind में मौजूद current result के आधार पर समझाऊँगा।',
      medical: 'Professional medical consultation की सलाह इसलिए दी जा सकती है क्योंकि AI image classifier गलत हो सकता है और आपकी पूरी medical history, physical examination, symptoms या समय के साथ हुए बदलावों को नहीं देखता। Dermatologist lesion को पूरे संदर्भ में देखकर आगे की जाँच की आवश्यकता तय कर सकता है।'
    }
  };

  const LOCALE = { en: 'en-IN', te: 'te-IN', hi: 'hi-IN' };
  let language = 'en';
  let recognition = null;
  let lastResponse = '';

  const $ = id => document.getElementById(id);
  const responseEl = $('assistantResponse');
  const inputEl = $('assistantText');
  const langEl = $('assistantLanguage');
  const statusEl = $('assistantStatus');
  const speakBtn = $('assistantSpeak');
  const stopBtn = $('assistantStop');
  const micBtn = $('assistantMic');

  function safe(value) {
    return value === undefined || value === null || value === '' ? 'not available' : String(value);
  }

  function formatStatus(value) {
    if (!value) return 'not available';
    const map = { good: 'good', poor: 'poor', invalid: 'invalid' };
    return map[String(value).toLowerCase()] || String(value);
  }

  function getData() {
    try {
      return typeof window.getDermaMindAnalysisContext === 'function'
        ? window.getDermaMindAnalysisContext()
        : null;
    } catch (_) {
      return null;
    }
  }

  function getXaiReady() {
    // xai.js updates the same flag through its lifecycle hook below.
    return !!window.__dermaMindXaiReady;
  }

  function syncText() {
    const t = ASSISTANT_TEXT[language];
    $('assistantTitle').textContent = t.title;
    $('assistantSubtitle').textContent = t.subtitle;
    $('assistantLanguage').previousElementSibling.firstChild.textContent = `${t.language} `;
    inputEl.placeholder = t.placeholder;
    $('assistantSend').textContent = t.send;
    speakBtn.textContent = t.speak;
    stopBtn.textContent = t.stop;
    micBtn.textContent = t.mic;
    $('assistantDisclaimer').textContent = t.disclaimer;
    statusEl.textContent = t.ready;

    document.querySelectorAll('[data-assistant-intent]').forEach(btn => {
      const intent = btn.dataset.assistantIntent;
      const labels = {
        en: { upload: 'How do I upload an image?', prediction: 'What does my prediction mean?', confidence: 'What does confidence mean?', heatmap: 'What does the heatmap mean?', next: 'What should I do next?' },
        te: { upload: 'చిత్రాన్ని ఎలా అప్‌లోడ్ చేయాలి?', prediction: 'నా prediction అంటే ఏమిటి?', confidence: 'Confidence అంటే ఏమిటి?', heatmap: 'Heatmap అంటే ఏమిటి?', next: 'ఇప్పుడు నేను ఏమి చేయాలి?' },
        hi: { upload: 'Image कैसे upload करूँ?', prediction: 'मेरी prediction का क्या मतलब है?', confidence: 'Confidence का क्या मतलब है?', heatmap: 'Heatmap का क्या मतलब है?', next: 'अब मुझे क्या करना चाहिए?' }
      };
      btn.textContent = labels[language][intent];
    });
  }

  function intentFor(question) {
    const q = String(question || '').toLowerCase().trim();
    if (!q) return 'generic';
    if (/(upload|image|photo|picture|चित्र|फोटो|इमेज|अपलोड|చిత్ర|ఫోటో|అప్.?లోడ్)/i.test(q) &&
        /(how|where|ఎలా|कैसे|upload|అప్)/i.test(q)) return 'upload';
    if (/(confidence|विश्वास|కन्फिडेंस|నమ్మకం)/i.test(q)) return 'confidence';
    if (/(heatmap|heat map|xai|हీట్मैप|హీట్.?మ్యాప్|highlight|हाइलाइट|హైలైట్)/i.test(q)) return 'heatmap';
    if (/(next|do now|what should|अब क्या|क्या करना|తర్వాత|ఇప్పుడు|ఏం చేయాలి)/i.test(q)) return 'next';
    if (/(prediction|predict|result|classification|what.*mean|मतलब|prediction|ఫలితం|prediction అంటే)/i.test(q)) return 'prediction';
    if (/(suitable|suitability|quality|clear|blurry|उपयुक्त|क्वालिटी|సరిపోతుంద|నాణ్యత)/i.test(q)) return 'suitability';
    if (/(explain|explanation|क्यों|व्याख्या|వివరణ)/i.test(q)) return 'explanation';
    if (/(doctor|dermatologist|medical|consult|डॉक्टर|dermatologist|వైద్య|డెర్మటాలజిస్ట్)/i.test(q)) return 'medical';
    return 'generic';
  }

  function answer(question, forcedIntent) {
    const t = ASSISTANT_TEXT[language];
    const data = getData();
    const intent = forcedIntent || intentFor(question);
    if (intent === 'upload') return t.upload;
    if (!data && ['prediction', 'confidence', 'suitability', 'heatmap', 'next', 'explanation'].includes(intent)) return t.noResult;
    if (intent === 'prediction') return t.prediction(data);
    if (intent === 'confidence') return t.confidence(data);
    if (intent === 'suitability') return t.suitability(data);
    if (intent === 'heatmap') return t.heatmap(data);
    if (intent === 'next') return t.next(data);
    if (intent === 'explanation') return t.explanation(data);
    if (intent === 'medical') return t.medical;
    return t.generic(data);
  }

  function showResponse(text) {
    lastResponse = String(text || '');
    responseEl.textContent = lastResponse;
  }

  function speak() {
    if (!('speechSynthesis' in window)) {
      statusEl.textContent = 'Speech playback is not supported by this browser.';
      return;
    }
    const text = lastResponse || answer('', 'generic');
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = LOCALE[language];
    utterance.rate = 0.95;
    utterance.pitch = 1;
    utterance.onstart = () => { statusEl.textContent = ASSISTANT_TEXT[language].speaking; speakBtn.disabled = true; stopBtn.disabled = false; };
    utterance.onend = utterance.onerror = () => { statusEl.textContent = ASSISTANT_TEXT[language].ready; speakBtn.disabled = false; stopBtn.disabled = true; };
    window.speechSynthesis.speak(utterance);
  }

  function stopSpeaking() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    speakBtn.disabled = false;
    stopBtn.disabled = true;
    statusEl.textContent = ASSISTANT_TEXT[language].ready;
  }

  function startRecognition() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      statusEl.textContent = ASSISTANT_TEXT[language].micUnsupported;
      return;
    }
    if (recognition) {
      try { recognition.abort(); } catch (_) {}
    }
    recognition = new Recognition();
    recognition.lang = LOCALE[language];
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      micBtn.classList.add('listening');
      statusEl.textContent = ASSISTANT_TEXT[language].listening;
    };
    recognition.onresult = event => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) transcript += event.results[i][0].transcript;
      inputEl.value = transcript.trim();
    };
    recognition.onerror = event => {
      const t = ASSISTANT_TEXT[language];
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') statusEl.textContent = t.micDenied;
      else if (event.error === 'no-speech') statusEl.textContent = t.noSpeech;
      else statusEl.textContent = t.speechError;
    };
    recognition.onend = () => {
      micBtn.classList.remove('listening');
      if (!statusEl.textContent.includes('permission') && !statusEl.textContent.includes('Permission') &&
          !statusEl.textContent.includes('supported') && !statusEl.textContent.includes('मिली') && !statusEl.textContent.includes('లేదు')) {
        statusEl.textContent = ASSISTANT_TEXT[language].ready;
      }
    };
    try { recognition.start(); }
    catch (_) { statusEl.textContent = ASSISTANT_TEXT[language].speechError; }
  }

  function refreshContext() {
    // Keep the existing answer text if the user is reading it, but update
    // heatmap readiness and the generic response when no question is active.
    if (!lastResponse) return;
    const lower = lastResponse.toLowerCase();
    if (lower.includes('heatmap') || lower.includes('xai') || lower.includes('హీట్') || lower.includes('हेट')) {
      showResponse(answer('', 'heatmap'));
    }
  }

  function updateXaiFlag() {
    // Read the DOM state instead of touching XAI generation itself.
    const loading = $('xaiLoading');
    window.__dermaMindXaiReady = !!loading && loading.classList.contains('hidden') &&
      !!$('xaiImage')?.src && $('xaiImage').src !== window.location.href;
    refreshContext();
  }

  langEl.addEventListener('change', () => {
    language = langEl.value;
    stopSpeaking();
    syncText();
    if (lastResponse) showResponse(answer(inputEl.value));
  });

  $('assistantSend').addEventListener('click', () => {
    showResponse(answer(inputEl.value));
  });

  inputEl.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      showResponse(answer(inputEl.value));
    }
  });

  document.querySelectorAll('[data-assistant-intent]').forEach(btn => {
    btn.addEventListener('click', () => {
      const intent = btn.dataset.assistantIntent;
      inputEl.value = '';
      showResponse(answer('', intent));
    });
  });

  speakBtn.addEventListener('click', speak);
  stopBtn.addEventListener('click', stopSpeaking);
  micBtn.addEventListener('click', startRecognition);

  // Browser support is feature-detected; the assistant remains fully usable by text.
  if (!(window.SpeechRecognition || window.webkitSpeechRecognition)) {
    micBtn.title = ASSISTANT_TEXT.en.micUnsupported;
  }

  syncText();
  window.DermaMindVoiceAssistant = {
    refreshContext,
    setLanguage: value => {
      if (ASSISTANT_TEXT[value]) {
        langEl.value = value;
        language = value;
        syncText();
      }
    },
    getAnswer: question => answer(question)
  };

  // XAI is generated asynchronously. Poll only the UI state; no XAI code is changed.
  setTimeout(updateXaiFlag, 0);
  const observer = new MutationObserver(updateXaiFlag);
  if ($('xaiLoading')) observer.observe($('xaiLoading'), { attributes: true, attributeFilter: ['class'] });
})();
