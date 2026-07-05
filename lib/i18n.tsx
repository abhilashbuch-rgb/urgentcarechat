// Lightweight i18n for the triage chat UI. Scoped to the free triage
// experience only — the paid telehealth consent/legal text stays in
// English pending a professional translation review, since mistranslating
// a fee/consent disclosure carries real risk.

export type Language = "en" | "es";

export const STRINGS = {
  en: {
    disclaimerTitle: "Before you continue",
    disclaimerItems: [
      <>This chat is powered by AI, <strong>not a doctor</strong>. It does not diagnose, treat, or prescribe.</>,
      <>Life-threatening emergency? Call <strong>911</strong> now. Mental health crisis? Call or text <strong>988</strong>.</>,
      <>Nothing here is a substitute for professional medical advice, diagnosis, or treatment from a licensed provider.</>,
      <>Clinic hours, insurance, and services shown are sourced from third parties and may be inaccurate — confirm directly with the clinic before relying on them.</>,
      <>We don&apos;t collect or store personal health information beyond what&apos;s needed to show you nearby clinics. If you opt in to a follow-up text, your phone number is used only to send that one message.</>,
    ],
    disclaimerBtn: "I understand — continue",
    openingWhoFor:
      "Hi — I'm an AI assistant, not a doctor. If this is a life-threatening emergency, please call 911 right now.\n\nWho is this for?",
    whoForMyself: "Myself",
    whoForChild: "My child",
    whoForOther: "Someone else",
    symptomPrompt:
      "Got it. Tell me what's going on and I'll help you find a nearby urgent care.",
    qrFindClinics: "Find clinics near me",
    qrSymptomQuestion: "I have a symptom question",
    qrTalkDoctor: "Talk to a doctor now — $100",
    inputPlaceholder: "What's going on?",
    footerNote: "Free public service · Not affiliated with any clinic · No personal data stored unless you opt in to a follow-up text",
    disclaimerBannerNotDoctor: "Not a doctor.",
    disclaimerBannerBody: (
      <>
        If this is a life-threatening emergency, call <strong>911</strong> immediately.
        For mental health crisis, call or text <strong>988</strong>.
      </>
    ),
    doctorCta: "Talk to a doctor",
    langToggleLabel: "Español",
    geoNoSupport: "Your browser doesn't support location services. You can type your zip code instead.",
    geoUserBubble: "Find urgent care near me",
    geoResultsIntro: "Here are the closest urgent care clinics to your location:",
    geoNoResults: "I couldn't find urgent care clinics near your location. Try entering your zip code instead.",
    geoApiError: "Something went wrong finding clinics near you. Try entering your zip code instead.",
    geoCatchError: "Something went wrong. Please try typing your zip code instead.",
    geoDenied: "I wasn't able to access your location. You can type your zip code and I'll find clinics near you.",
    clinicSearchNoResults: "I wasn't able to find urgent care clinics near that zip code. Could you double-check the zip, or try a nearby one?",
    chatConnectError: "Sorry, I'm having trouble connecting right now. If this is an emergency, please call 911. Otherwise, try again in a moment.",
    alert911Title: "This may be a medical emergency.",
    alert911Cta: "Call 911",
    alert988Title: "I want you to be safe.",
    alert988Cta: "Call or text 988",
    careUrgent: "Urgent care recommended",
    careSelf: "Self-care may be enough",
    followUpPrompt: "Text me later to see how it went (optional)",
    followUpPlaceholder: "Your phone number",
    followUpSubmit: "Text me",
    followUpSubmitting: "Scheduling…",
    followUpSuccess: "Got it — we'll text you in a few hours to check in.",
    followUpError: "Something went wrong. Please try again.",
    claimPrompt: "Is this your clinic? Claim this listing",
    claimNamePlaceholder: "Your name",
    claimEmailPlaceholder: "Business email",
    claimSubmit: "Submit",
    claimSubmitting: "Submitting…",
    claimSuccess: "Thanks — we'll review and follow up by email.",
    claimError: "Something went wrong. Please try again.",
    featuredTag: "Featured",
  },
  es: {
    disclaimerTitle: "Antes de continuar",
    disclaimerItems: [
      <>Este chat funciona con IA, <strong>no es un médico</strong>. No diagnostica, trata ni receta.</>,
      <>¿Emergencia potencialmente mortal? Llame al <strong>911</strong> ahora. ¿Crisis de salud mental? Llame o envíe un mensaje de texto al <strong>988</strong>.</>,
      <>Nada aquí sustituye el consejo, diagnóstico o tratamiento médico profesional de un proveedor con licencia.</>,
      <>El horario, seguro y servicios de las clínicas provienen de terceros y pueden ser inexactos — confirme directamente con la clínica antes de confiar en ellos.</>,
      <>No recopilamos ni almacenamos información médica personal más allá de lo necesario para mostrarle clínicas cercanas. Si opta por un mensaje de seguimiento, su número de teléfono se usa solo para enviar ese mensaje.</>,
    ],
    disclaimerBtn: "Entiendo — continuar",
    openingWhoFor:
      "Hola — soy un asistente de IA, no un médico. Si esto es una emergencia potencialmente mortal, llame al 911 ahora mismo.\n\n¿Para quién es esto?",
    whoForMyself: "Para mí",
    whoForChild: "Para mi hijo/a",
    whoForOther: "Para otra persona",
    symptomPrompt:
      "Entendido. Cuénteme qué está pasando y le ayudaré a encontrar una clínica de urgencias cercana.",
    qrFindClinics: "Buscar clínicas cercanas",
    qrSymptomQuestion: "Tengo una pregunta sobre síntomas",
    qrTalkDoctor: "Hablar con un médico ahora — $100",
    inputPlaceholder: "¿Qué está pasando?",
    footerNote: "Servicio público gratuito · No afiliado con ninguna clínica · No se guardan datos personales salvo que opte por un mensaje de seguimiento",
    disclaimerBannerNotDoctor: "No es un médico.",
    disclaimerBannerBody: (
      <>
        Si esto es una emergencia potencialmente mortal, llame al <strong>911</strong> de
        inmediato. Para crisis de salud mental, llame o envíe un mensaje de texto al{" "}
        <strong>988</strong>.
      </>
    ),
    doctorCta: "Hablar con un médico",
    langToggleLabel: "English",
    geoNoSupport: "Su navegador no admite servicios de ubicación. Puede escribir su código postal en su lugar.",
    geoUserBubble: "Buscar urgencias cerca de mí",
    geoResultsIntro: "Estas son las clínicas de urgencias más cercanas a su ubicación:",
    geoNoResults: "No pude encontrar clínicas de urgencias cerca de su ubicación. Intente escribir su código postal.",
    geoApiError: "Algo salió mal al buscar clínicas cerca de usted. Intente escribir su código postal.",
    geoCatchError: "Algo salió mal. Intente escribir su código postal.",
    geoDenied: "No pude acceder a su ubicación. Puede escribir su código postal y buscaré clínicas cercanas.",
    clinicSearchNoResults: "No pude encontrar clínicas de urgencias cerca de ese código postal. ¿Puede verificarlo o probar con uno cercano?",
    chatConnectError: "Lo siento, tengo problemas para conectarme en este momento. Si esto es una emergencia, llame al 911. De lo contrario, intente de nuevo en un momento.",
    alert911Title: "Esto podría ser una emergencia médica.",
    alert911Cta: "Llamar al 911",
    alert988Title: "Quiero que esté a salvo.",
    alert988Cta: "Llamar o enviar texto al 988",
    careUrgent: "Se recomienda atención de urgencias",
    careSelf: "El autocuidado puede ser suficiente",
    followUpPrompt: "Envíenme un mensaje más tarde para saber cómo me fue (opcional)",
    followUpPlaceholder: "Su número de teléfono",
    followUpSubmit: "Envíenme un mensaje",
    followUpSubmitting: "Programando…",
    followUpSuccess: "Listo — le enviaremos un mensaje en unas horas para saber cómo le fue.",
    followUpError: "Algo salió mal. Intente de nuevo.",
    claimPrompt: "¿Es su clínica? Reclame este anuncio",
    claimNamePlaceholder: "Su nombre",
    claimEmailPlaceholder: "Correo electrónico laboral",
    claimSubmit: "Enviar",
    claimSubmitting: "Enviando…",
    claimSuccess: "Gracias — revisaremos y le responderemos por correo.",
    claimError: "Algo salió mal. Intente de nuevo.",
    featuredTag: "Destacado",
  },
} as const;

export function getStoredLanguage(): Language {
  if (typeof window === "undefined") return "en";
  const stored = localStorage.getItem("uc_lang");
  return stored === "es" ? "es" : "en";
}
