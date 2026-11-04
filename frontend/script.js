const menuToggle = document.getElementById("menuToggle");
const navLinks = document.getElementById("navLinks");

menuToggle?.addEventListener("click", () => {
    const isOpen = navLinks.classList.toggle("active");
    menuToggle.setAttribute("aria-expanded", String(isOpen));
    menuToggle.textContent = isOpen ? "×" : "☰";
});

document.querySelectorAll(".nav-links a").forEach((link) => {
    link.addEventListener("click", () => {
        navLinks?.classList.remove("active");
        menuToggle?.setAttribute("aria-expanded", "false");
        if (menuToggle) menuToggle.textContent = "☰";
    });
});

const year = new Date().getFullYear();
const footerText = document.querySelector(".footer p");
if (footerText) {
    footerText.textContent = `© ${year} ZIBEN Nova. All Rights Reserved.`;
}

const workspace = document.getElementById("workspace");
const workspaceContent = document.getElementById("workspaceContent");
const workspaceBreadcrumb = document.getElementById("workspaceBreadcrumb");
const workspaceApiState = document.getElementById("workspaceApiState");
const workspaceNavigation = document.getElementById("workspaceNavigation");
const workspaceRefresh = document.getElementById("workspaceRefresh");
const serviceStatus = document.getElementById("serviceStatus");
const apiStatus = document.getElementById("apiStatus");
const databaseStatus = document.getElementById("databaseStatus");
const refreshStatus = document.getElementById("refreshStatus");

const modules = [
    { id: "products", title: "المنتجات", group: "التجارة", icon: "◈", statusId: "commerce" },
    { id: "inventory", title: "المخزون", group: "التجارة", icon: "▤", statusId: "commerce" },
    { id: "orders", title: "الطلبات و COD", group: "التجارة", icon: "⇄", statusId: "commerce" },
    { id: "customers", title: "العملاء", group: "التجارة", icon: "♙", statusId: "commerce" },
    { id: "ai-studio", title: "استوديو AI", group: "الذكاء والتشغيل", icon: "✦", statusId: "ai-studio" },
    { id: "agents", title: "الوكلاء", group: "الذكاء والتشغيل", icon: "✧", statusId: "ai-agents" },
    { id: "market", title: "ذكاء السوق", group: "الذكاء والتشغيل", icon: "◉", statusId: "market-intelligence" },
    { id: "automation", title: "الأتمتة", group: "الذكاء والتشغيل", icon: "⚡", statusId: "automation" },
    { id: "analytics", title: "التحليلات", group: "الذكاء والتشغيل", icon: "▥", statusId: "command-center" },
    { id: "activity", title: "سجل النشاط", group: "النظام", icon: "◷", statusId: "identity" },
    { id: "notifications", title: "التنبيهات", group: "النظام", icon: "♧", statusId: "identity" },
    { id: "settings", title: "الإعدادات", group: "النظام", icon: "⚙", statusId: "identity" },
];

const capabilityLabels = {
    "command-center": "مركز القيادة",
    commerce: "التجارة",
    "ai-studio": "استوديو AI",
    "ai-agents": "الوكلاء",
    "market-intelligence": "ذكاء السوق",
    automation: "الأتمتة",
    identity: "الهوية والصلاحيات",
};

let capabilityStates = new Map();
let activeModule = "dashboard";

function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

function append(parent, tag, className, text) {
    const element = createElement(tag, className, text);
    parent.append(element);
    return element;
}

function getApiBaseUrl() {
    const configured = document
        .querySelector('meta[name="ziben-api-base-url"]')
        ?.getAttribute("content")
        ?.trim();
    const apiUrl = configured
        ? new URL(configured, window.location.href)
        : new URL(window.location.origin);
    if (
        !["http:", "https:"].includes(apiUrl.protocol) ||
        apiUrl.username ||
        apiUrl.password ||
        apiUrl.pathname !== "/" ||
        apiUrl.search ||
        apiUrl.hash
    ) {
        throw new Error("Unsupported API base URL");
    }
    return apiUrl.origin;
}

function moduleAvailability(status) {
    if (status === "available") return "متاح";
    if (status === "partial") return "متاح جزئياً";
    if (status === "not_implemented") return "قيد التطوير";
    return "غير معروف";
}

function statusClass(status) {
    if (status === "available") return "available";
    if (status === "partial") return "partial";
    return "unavailable";
}

function createPageHeading(title, description, eyebrow = "مساحة العمل") {
    const heading = createElement("div", "workspace-page-heading");
    append(heading, "span", "section-tag", eyebrow);
    const titleElement = append(heading, "h1", "", title);
    titleElement.tabIndex = -1;
    append(heading, "p", "", description);
    workspaceContent.append(heading);
}

function createNotice(title, description, kind = "info") {
    const notice = createElement("div", `workspace-notice ${kind}`);
    append(notice, "strong", "", title);
    append(notice, "p", "", description);
    return notice;
}

function createEmptyState(title, description, actionLabel) {
    const empty = createElement("div", "workspace-empty-state");
    append(empty, "span", "workspace-empty-icon", "◇");
    append(empty, "h3", "", title);
    append(empty, "p", "", description);
    if (actionLabel) {
        const action = append(empty, "button", "workspace-disabled-action", actionLabel);
        action.disabled = true;
        action.title = "يتطلب خدمة خلفية وهوية مستخدم لم يتم إعدادهما بعد";
    }
    return empty;
}

function renderDashboard() {
    createPageHeading(
        "مركز القيادة",
        "صورة تشغيلية لما تم توصيله فعلياً — من دون مقاييس أعمال أو نشاط محاكى.",
        "COMMAND CENTER",
    );

    const apiConnected = workspaceApiState?.dataset.state === "connected";
    const databaseConnected = serviceStatus?.dataset.state === "ready";
    const statusSection = append(workspaceContent, "section", "command-status-section");
    append(statusSection, "div", "command-section-kicker", "HEALTH / 01");
    const statusGrid = append(statusSection, "div", "command-status-grid");
    appendStatusCard(statusGrid, {
        eyebrow: "PLATFORM API",
        title: apiConnected ? "واجهة API متصلة" : "واجهة API غير متاحة",
        detail: apiConnected
            ? "تم جلب تعريفات الوحدات من نقطة القدرات."
            : "تحقق من عنوان الخدمة واتصال واجهة API.",
        status: apiConnected ? "good" : "bad",
        icon: "↗",
    });
    appendStatusCard(statusGrid, {
        eyebrow: "POSTGRESQL",
        title: databaseConnected ? "قاعدة البيانات جاهزة" : "قاعدة البيانات غير متاحة",
        detail: databaseConnected
            ? "فحص الجاهزية نجح؛ لا يعني ذلك تفعيل وصول المؤسسة."
            : "لا يوجد اتصال قاعدة بيانات مؤكد من فحص الجاهزية.",
        status: databaseConnected ? "good" : "bad",
        icon: "▤",
    });
    appendStatusCard(statusGrid, {
        eyebrow: "TENANT ACCESS",
        title: "بيانات المؤسسة مقفلة",
        detail: "مزود الهوية وحدّ عزل قاعدة البيانات الموثوق غير مفعّلين.",
        status: "warning",
        icon: "⌑",
    });

    const commandGrid = append(workspaceContent, "div", "command-main-grid");
    const topology = append(commandGrid, "section", "command-panel command-topology");
    appendPanelHeading(topology, "خريطة الوحدات", "MODULE REGISTRY", "حالة التنفيذ المعلنة عبر API");
    append(topology, "p", "command-panel-note", "هذه حالة توفر ثابتة وليست بثاً مباشراً لنشاط الوكلاء أو المهام.");
    const topologyList = append(topology, "div", "module-topology-list");
    modules.slice(0, 8).forEach((module, index) => {
        const row = append(topologyList, "div", "module-topology-row");
        append(row, "span", "topology-index", String(index + 1).padStart(2, "0"));
        append(row, "span", "topology-node", "");
        append(row, "span", "topology-name", module.title);
        const state = capabilityStates.get(module.statusId);
        append(row, "span", `topology-state ${statusClass(state)}`, moduleAvailability(state));
        row.setAttribute("aria-label", `${module.title}: ${moduleAvailability(state)}`);
    });
    append(topology, "p", "command-source-note", "المصدر: GET /api/v1/capabilities · لا تتوفر أحداث تشغيل آنية.");

    const focus = append(commandGrid, "section", "command-panel command-focus");
    appendPanelHeading(focus, "الأعمال والذكاء", "BUSINESS SIGNALS", "بيانات موثقة فقط");
    const emptySignals = append(focus, "div", "command-signal-empty");
    append(emptySignals, "span", "signal-empty-mark", "—");
    append(emptySignals, "h3", "", "لا توجد مصادر أعمال متصلة");
    append(emptySignals, "p", "", "الإيرادات والطلبات والعملاء والتحويلات غير متاحة حتى تتصل واجهات التجارة ومصدر بيانات موثوق.");
    const businessLinks = append(focus, "div", "command-link-row");
    appendModuleLink(businessLinks, "الطلبات", "orders");
    appendModuleLink(businessLinks, "التحليلات", "analytics");

    const operations = append(workspaceContent, "section", "command-operations-section");
    appendPanelHeading(operations, "جاهزية التشغيل", "OPERATIONS / 02", "تكاملات لم يتم تفعيلها بعد");
    const integrationGrid = append(operations, "div", "integration-status-grid");
    [
        { title: "موفر الهوية", detail: "لا يوجد OIDC موصول", state: "غير مهيأ", module: "settings" },
        { title: "AI و الوكلاء", detail: "لا يوجد موفر أو سجل تنفيذ دائم", state: "غير متصل", module: "ai-studio" },
        { title: "الأتمتة", detail: "لا يوجد عامل مهام أو n8n موصول", state: "غير متصل", module: "automation" },
        { title: "ذكاء السوق", detail: "لا توجد مصادر أدلة محفوظة", state: "بلا بيانات", module: "market" },
    ].forEach((integration) => {
        const item = append(integrationGrid, "button", "integration-status-item");
        item.type = "button";
        item.dataset.openModule = integration.module;
        append(item, "span", "integration-indicator", "");
        append(item, "span", "integration-title", integration.title);
        append(item, "strong", "", integration.state);
        append(item, "small", "", integration.detail);
    });

    const accessNote = createNotice(
        "حدود أمان المؤسسة",
        "سيبقى وصول بيانات المستأجر معطلاً حتى اعتماد موفر هوية والتحقق من سياق قاعدة البيانات واختبارات العزل PostgreSQL.",
        "warning",
    );
    accessNote.classList.add("command-security-note");
    workspaceContent.append(accessNote);
}

function appendStatusCard(parent, { eyebrow, title, detail, status, icon }) {
    const card = append(parent, "article", `command-status-card is-${status}`);
    const top = append(card, "div", "command-status-top");
    append(top, "span", "command-status-icon", icon);
    append(top, "span", "command-status-eyebrow", eyebrow);
    append(card, "h2", "", title);
    append(card, "p", "", detail);
}

function appendPanelHeading(parent, title, eyebrow, detail) {
    const heading = append(parent, "div", "command-panel-heading");
    const copy = append(heading, "div", "");
    append(copy, "span", "command-section-kicker", eyebrow);
    append(copy, "h2", "", title);
    append(heading, "p", "", detail);
}

function appendModuleLink(parent, title, moduleId) {
    const link = append(parent, "button", "command-text-link", `${title} ←`);
    link.type = "button";
    link.dataset.openModule = moduleId;
}

const modulePages = {
    products: {
        title: "المنتجات",
        group: "التجارة",
        statusId: "commerce",
        description: "إدارة كتالوج المنتجات والخيارات والتسعير.",
        explanation: "توجد قواعد نطاق أولية للطلبات و COD فقط. API الكتالوج ومخطط قاعدة البيانات التجاري لم يتم تنفيذهما بعد.",
        emptyTitle: "لا توجد منتجات",
        emptyDescription: "لم يتم ربط متجر أو تحميل كتالوج. لن يتم إنشاء سجلات تجريبية.",
        action: "إضافة منتج",
    },
    inventory: {
        title: "المخزون",
        group: "التجارة",
        statusId: "commerce",
        description: "متابعة مستويات المخزون وحركاته.",
        explanation: "لا توجد خدمة مخزون أو قاعدة بيانات. قواعد المخزون والحجز المتزامن غير منفذة.",
        emptyTitle: "لا توجد سجلات مخزون",
        emptyDescription: "ستظهر مستويات المخزون بعد تنفيذ التكامل مع المنتجات والمستودعات.",
        action: "تسجيل حركة مخزون",
    },
    orders: {
        title: "الطلبات و COD",
        group: "التجارة",
        statusId: "commerce",
        description: "إدارة الطلبات وتأكيد الدفع عند الاستلام ومراحل الشحن.",
        explanation: "توجد قواعد أولية لتغييرات حالة الطلب وتحصيل COD وتسويته. خدمة الطلبات والتأكيد والشحن غير متاحة.",
        emptyTitle: "لا توجد طلبات",
        emptyDescription: "لا يوجد متجر متصل أو طلبات مستوردة. لن نعرض طلبات افتراضية.",
        action: "إنشاء طلب",
    },
    customers: {
        title: "العملاء",
        group: "التجارة",
        statusId: "commerce",
        description: "ملفات العملاء وسجل التعاملات.",
        explanation: "لم يتم تنفيذ قاعدة بيانات العملاء أو واجهاتها.",
        emptyTitle: "لا توجد ملفات عملاء",
        emptyDescription: "لن يتم إنشاء بيانات شخصية قبل توفر مصدر حقيقي وضوابط الوصول.",
        action: "إضافة عميل",
    },
    "ai-studio": {
        title: "استوديو AI",
        group: "الذكاء والتشغيل",
        statusId: "ai-studio",
        description: "إدارة مزودي النماذج والمطالبات وتنفيذات الذكاء الاصطناعي.",
        explanation: "توجد حدود تنفيذ بمزودات قابلة للتوسعة مع مهلة وقيود إدخال وتتبع استخدام لكل استجابة. لا يوجد مزود مسجل أو اعتماد سري أو توثيق موافقة بشرية موثوق.",
        emptyTitle: "لا يوجد مزود AI مفعّل",
        emptyDescription: "لن يتم إرسال بيانات إلى نموذج أو محاكاة نتائج. يلزم اختيار مزود وتنفيذ حدود الاستخدام والموافقة البشرية.",
        action: "إعداد مزود AI",
    },
    agents: {
        title: "الوكلاء",
        group: "الذكاء والتشغيل",
        statusId: "ai-agents",
        description: "تعريف الوكلاء وأدواتهم ومراجعة التنفيذات.",
        explanation: "يوجد محرك محدود بخطة JSON وأدوات مسموح بها وسياق tenant موثّق وبوابة موافقة للكتابة. لا يوجد مخزن تعريفات أو سجل تنفيذ دائم مهيأ.",
        emptyTitle: "لا توجد وكلاء مهيأة",
        emptyDescription: "محرك التنفيذ موجود لكنه يتطلب تعريف وكيل ومزود AI ومخزن سجل دائم قبل تشغيل المهام.",
        action: "إنشاء وكيل",
    },
    market: {
        title: "ذكاء السوق",
        group: "الذكاء والتشغيل",
        statusId: "market-intelligence",
        description: "تحليل الأدلة السوقية الإقليمية مع فصل الحقائق عن الاستنتاجات.",
        explanation: "توجد طبقة تطبيع تتحقق من تصنيف الدليل والمصدر والمنطقة والثقة وروابط الاستنتاجات. لا توجد قاعدة أدلة أو مصادر خارجية موثوقة.",
        emptyTitle: "لا توجد أدلة سوق مخزنة",
        emptyDescription: "طبقة التحقق جاهزة للدمج، لكن لا توجد قاعدة بيانات أو مصادر مرتبطة. لن نعرض إحصاءات أو معلومات منافسين مختلقة.",
        action: "إضافة مصدر بيانات",
    },
    automation: {
        title: "الأتمتة",
        group: "الذكاء والتشغيل",
        statusId: "automation",
        description: "إدارة تدفقات العمل وتتبع المحاولات والأخطاء.",
        explanation: "يوجد مدقق HMAC لحمولة webhook الخام مع توقيت محدود. يلزم تخزين منع الإعادة الدائم ومحرك مهام وتكامل n8n.",
        emptyTitle: "لا توجد تدفقات عمل موصولة",
        emptyDescription: "التحقق وحده لا يشغل تدفقاً ولا يمنع إعادة الطلبات من دون تخزين دائم. لن يتم إرسال webhooks من هذه الواجهة.",
        action: "إنشاء تدفق عمل",
    },
    analytics: {
        title: "التحليلات",
        group: "الذكاء والتشغيل",
        statusId: "command-center",
        description: "مؤشرات مشتقة من بيانات النشاط الحقيقي فقط.",
        explanation: "المتاح حالياً هو فحص صحة الخدمة؛ لا توجد مصادر طلبات أو إيرادات متصلة.",
        emptyTitle: "التحليلات غير متاحة",
        emptyDescription: "لن نعرض رسومًا أو أرقامًا حتى تتوفر بيانات موثوقة ومصرّح بها.",
    },
    activity: {
        title: "سجل النشاط",
        group: "النظام",
        statusId: "identity",
        description: "سجل تدقيق قابل للمراجعة لأحداث المنصة.",
        explanation: "لا يوجد مخزن تدقيق مرتبط بهوية المستخدم.",
        emptyTitle: "لا توجد أحداث تدقيق",
        emptyDescription: "سجل النشاط غير مفعّل. فحوصات الصحة لا تمثل سجلاً لنشاط المستخدم.",
    },
    notifications: {
        title: "التنبيهات",
        group: "النظام",
        statusId: "identity",
        description: "تنبيهات تشغيلية مرتبطة بحسابك ومساحاتك.",
        explanation: "لا توجد خدمة تنبيهات أو جلسة مستخدم.",
        emptyTitle: "لا توجد تنبيهات",
        emptyDescription: "التنبيهات غير مفعّلة؛ هذه الحالة لا تعني عدم وجود أحداث في حساب تجاري.",
    },
    settings: {
        title: "الإعدادات",
        group: "النظام",
        statusId: "identity",
        description: "إعداد المؤسسة والمستخدم والتكاملات.",
        explanation: "لا توجد هوية مصادق عليها أو مساحة مؤسسة لإدارة إعداداتها.",
        emptyTitle: "إعدادات المؤسسة غير متاحة",
        emptyDescription: "إعدادات الحساب والتكاملات مغلقة حتى تنفيذ المصادقة والصلاحيات.",
    },
};

function renderModule(id) {
    workspaceContent.replaceChildren();
    if (id === "dashboard") {
        renderDashboard();
        return;
    }
    renderModulePage(modulePages[id]);
}

function renderModulePage(module) {
    if (!module) return;
    if (activeModule === "ai-studio" || activeModule === "agents") {
        renderAgentStudio(activeModule);
        return;
    }
    if (activeModule === "market") {
        renderMarketIntelligence();
        return;
    }
    if (["products", "inventory", "orders", "customers"].includes(activeModule)) {
        renderCommerceWorkspace(module);
        return;
    }
    if (activeModule === "automation") {
        renderAutomationWorkspace(module);
        return;
    }
    createPageHeading(module.title, module.description, module.group.toUpperCase());
    const status = capabilityStates.get(module.statusId);
    const panel = append(workspaceContent, "section", "workspace-capability-panel");
    append(panel, "span", `workspace-module-status ${statusClass(status)}`, moduleAvailability(status));
    append(panel, "h2", "", `حالة ${capabilityLabels[module.statusId]}`);
    append(panel, "p", "", module.explanation);
    workspaceContent.append(createEmptyState(module.emptyTitle, module.emptyDescription, module.action));
}

function renderAgentStudio(id) {
    const isAgentList = id === "agents";
    createPageHeading(
        isAgentList ? "عمليات الوكلاء" : "استوديو AI",
        "مساحة إعداد وتشغيل الوكلاء بحدود أدوات واضحة وموافقة بشرية — من دون تشغيل تجريبي.",
        "AI OPERATIONS",
    );

    const readiness = append(workspaceContent, "section", "studio-readiness-banner");
    append(readiness, "span", "studio-readiness-mark", "✦");
    const readinessCopy = append(readiness, "div", "");
    append(readinessCopy, "strong", "", "بيئة التنفيذ غير مهيأة");
    append(readinessCopy, "p", "", "عقود التنفيذ موجودة في الخلفية، لكن موفر النموذج والتخزين الدائم والموافقة الموثوقة غير موصولة.");

    const studioGrid = append(workspaceContent, "div", "studio-main-grid");
    const configuration = append(studioGrid, "section", "command-panel studio-configuration");
    appendPanelHeading(configuration, "تهيئة مساحة العمل", "CONFIGURATION", "الإعدادات الحساسة تبقى على الخادم");
    [
        ["الموّفر والنموذج", "لا يوجد موفر مسجل"],
        ["حد الأدوات", "قائمة سماح مطلوبة"],
        ["موافقة الإجراءات", "تأكيد موثوق غير مهيأ"],
        ["سجل التنفيذ", "مخزن دائم غير موصول"],
    ].forEach(([label, state]) => {
        const row = append(configuration, "div", "studio-config-row");
        append(row, "span", "", label);
        append(row, "strong", "", state);
    });
    const configure = append(configuration, "button", "workspace-disabled-action", "إعداد الموفر");
    configure.disabled = true;
    configure.title = "يتطلب اختيار موفر وإعداد أسراره على الخادم";

    const lifecycle = append(studioGrid, "section", "command-panel studio-lifecycle");
    appendPanelHeading(lifecycle, "حدود تنفيذ الوكيل", "EXECUTION CONTROL", "المسار الآمن قبل أي إجراء");
    const steps = append(lifecycle, "ol", "agent-lifecycle");
    [
        ["تعريف الوكيل", "مخزن تعريفات غير مهيأ"],
        ["خطة منظمة", "تحقق بنيوي وحدود تنفيذ"],
        ["موافقة بشرية", "رفض افتراضي للأدوات الحساسة"],
        ["سجل دائم", "التنفيذ متوقف حتى التوصيل"],
    ].forEach(([title, detail], index) => {
        const step = append(steps, "li", "agent-lifecycle-step");
        append(step, "span", "agent-step-number", String(index + 1).padStart(2, "0"));
        const copy = append(step, "div", "");
        append(copy, "strong", "", title);
        append(copy, "small", "", detail);
    });

    const history = append(workspaceContent, "section", "command-panel studio-history");
    appendPanelHeading(history, "سجل التنفيذ", "EXECUTION HISTORY", "سجل حقيقي فقط");
    history.append(createEmptyState(
        "لا توجد تنفيذات محفوظة",
        "لا يوجد موفر AI أو تخزين تاريخ متصل. لن يتم إنشاء تنفيذ تجريبي أو ادعاء نجاح مهمة.",
    ));
}

function renderMarketIntelligence() {
    createPageHeading(
        "ذكاء السوق",
        "هيكل بحث إقليمي يربط كل استنتاج بمصدره، ونوع الدليل، ووقت جمعه.",
        "MARKET INTELLIGENCE · ALGERIA FIRST",
    );

    const trust = append(workspaceContent, "section", "market-trust-banner");
    append(trust, "span", "market-trust-symbol", "◈");
    const trustCopy = append(trust, "div", "");
    append(trustCopy, "strong", "", "لا توجد بيانات سوق موثقة متصلة");
    append(trustCopy, "p", "", "لا تعرض هذه المساحة إحصاءات أو أسعار منافسين أو سلوك شراء من دون مصدر موثوق وأثر منشأ.");

    const marketGrid = append(workspaceContent, "div", "market-main-grid");
    const regions = append(marketGrid, "section", "command-panel market-regions");
    appendPanelHeading(regions, "تغطية الأقاليم", "REGIONAL COVERAGE", "تقسيم تحليلي، لا خريطة بيانات");
    const regionList = append(regions, "div", "market-region-list");
    [
        ["الشمال الأوسط", "الجزائر · البليدة · تيزي وزو", "لا توجد أدلة"],
        ["الشرق", "قسنطينة · عنابة · سطيف", "لا توجد أدلة"],
        ["الغرب", "وهران · تلمسان · مستغانم", "لا توجد أدلة"],
        ["الجنوب", "ورقلة · غرداية · تمنراست", "لا توجد أدلة"],
    ].forEach(([name, examples, state]) => {
        const region = append(regionList, "article", "market-region-row");
        append(region, "span", "market-region-pin", "⌖");
        const copy = append(region, "div", "");
        append(copy, "strong", "", name);
        append(copy, "small", "", examples);
        append(region, "span", "market-region-state", state);
    });
    append(regions, "p", "command-source-note", "الأمثلة توضح اتجاهات التغطية فقط؛ ولا تمثل توقعات أو ترتيباً للمناطق.");

    const evidence = append(marketGrid, "section", "command-panel market-evidence");
    appendPanelHeading(evidence, "مستويات الثقة", "EVIDENCE & TRUST", "كل نتيجة مرتبطة بمصدر وتاريخ");
    [
        ["دليل موثق", "مصدر قابل للتحقق وتاريخ جمع", "verified"],
        ["ملاحظة مرصودة", "ملاحظة من بيانات متصلة ومصرح بها", "observed"],
        ["توصية مولدة", "فرضية AI وليست حقيقة سوقية", "hypothesis"],
        ["بيانات مفقودة", "لا يوجد مصدر أو سجل متاح", "missing"],
    ].forEach(([title, detail, kind]) => {
        const item = append(evidence, "div", `market-evidence-type is-${kind}`);
        append(item, "span", "evidence-type-mark", "");
        const copy = append(item, "div", "");
        append(copy, "strong", "", title);
        append(copy, "small", "", detail);
    });

    const intelligenceAreas = append(workspaceContent, "section", "command-panel market-areas");
    appendPanelHeading(intelligenceAreas, "مساحات التحليل", "INTELLIGENCE WORKBENCH", "تظهر عند ربط مصادر حقيقية");
    const areaGrid = append(intelligenceAreas, "div", "market-area-grid");
    [
        ["سلوك العملاء", "الدوافع، الاعتراضات، وإشارات الشراء"],
        ["مراقبة المنافسين", "مقارنات منتجات وأسعار مع مصادر"],
        ["أداء الحملات", "الجمهور والتحويل والأصول الإبداعية"],
        ["اللغة والمنطقة", "لغة العميل وتفضيلاته الإقليمية"],
    ].forEach(([title, detail]) => {
        const item = append(areaGrid, "article", "market-area-item");
        append(item, "span", "market-area-index", "—");
        append(item, "h3", "", title);
        append(item, "p", "", detail);
        append(item, "small", "", "بانتظار مصدر موثوق");
    });
}

function renderCommerceWorkspace(module) {
    createPageHeading(module.title, module.description, "COMMERCE OPERATIONS");
    const commerceNotice = append(workspaceContent, "section", "commerce-connection-banner");
    append(commerceNotice, "span", "studio-readiness-mark", "◈");
    const noticeCopy = append(commerceNotice, "div", "");
    append(noticeCopy, "strong", "", "لا يوجد موفر تجارة أو بيانات متجر متصل");
    append(noticeCopy, "p", "", "القواعد التجارية الأولية لا تعني وجود كتالوج أو طلبات أو مخزون فعلي.");

    const commerceGrid = append(workspaceContent, "section", "commerce-workspace-grid");
    [
        ["كتالوج المنتجات", "إدارة الكتالوج والخيارات والتسعير.", "products"],
        ["الطلبات و COD", "حالات الطلب والتحصيل والتسوية المنفصلة.", "orders"],
        ["المخزون", "المستويات والحركات والحجز المتزامن.", "inventory"],
        ["العملاء", "سجل العملاء بضوابط وصول وموافقة واضحة.", "customers"],
    ].forEach(([title, detail, moduleId]) => {
        const card = append(commerceGrid, "button", `commerce-workspace-item${activeModule === moduleId ? " active" : ""}`);
        card.type = "button";
        card.dataset.openModule = moduleId;
        append(card, "span", "commerce-item-icon", modules.find((item) => item.id === moduleId)?.icon ?? "◈");
        append(card, "strong", "", title);
        append(card, "small", "", detail);
        append(card, "span", "commerce-item-state", "غير متصل");
    });
    const commerceEmpty = createEmptyState(
        module.emptyTitle,
        module.emptyDescription,
        module.action,
    );
    commerceGrid.after(commerceEmpty);
}

function renderAutomationWorkspace(module) {
    createPageHeading(module.title, module.description, "AUTOMATION CONTROL");
    const warning = append(workspaceContent, "section", "studio-readiness-banner");
    append(warning, "span", "studio-readiness-mark", "⚡");
    const warningCopy = append(warning, "div", "");
    append(warningCopy, "strong", "", "لا توجد تدفقات تشغيل موصولة");
    append(warningCopy, "p", "", "التحقق من التوقيع وحده لا ينفذ مهاماً ولا يمنع إعادة الطلبات من دون تخزين دائم.");
    const checks = append(workspaceContent, "section", "automation-check-grid");
    [
        ["التحقق من التوقيع", "أساس HMAC موجود", "التحقق وحده غير كافٍ"],
        ["منع إعادة الطلب", "مخزن ذري غير موصول", "غير متاح"],
        ["عامل المهام", "لا يوجد معالج دائم", "غير متصل"],
        ["n8n", "لم يتم ربط مزود", "غير متصل"],
    ].forEach(([title, detail, state]) => {
        const item = append(checks, "article", "automation-check-item");
        append(item, "span", "integration-indicator", "");
        append(item, "h2", "", title);
        append(item, "p", "", detail);
        append(item, "strong", "", state);
    });
    workspaceContent.append(createEmptyState(
        module.emptyTitle,
        module.emptyDescription,
        module.action,
    ));
}

function setActiveModule(id) {
    if (id !== "dashboard" && !modulePages[id]) id = "dashboard";
    activeModule = id;
    const module = modulePages[id];
    const title = module?.title ?? "مركز القيادة";
    workspaceBreadcrumb.textContent = title;
    workspaceNavigation.querySelectorAll("[data-module]").forEach((button) => {
        const active = button.dataset.module === id;
        button.classList.toggle("active", active);
        if (active) {
            button.setAttribute("aria-current", "page");
        } else {
            button.removeAttribute("aria-current");
        }
    });
    renderModule(id);
}

function focusWorkspaceHeading() {
    workspaceContent.querySelector("h1")?.focus({ preventScroll: true });
}

function navigateToModule(id) {
    const nextHash = id === "dashboard" ? "#workspace" : `#workspace/${id}`;
    if (window.location.hash === nextHash) {
        setActiveModule(id);
        focusWorkspaceHeading();
    } else {
        window.location.hash = nextHash;
    }
}

function updateRoute() {
    const isWorkspace = window.location.hash === "#workspace" ||
        window.location.hash.startsWith("#workspace/");
    if (workspace) workspace.hidden = !isWorkspace;
    document.querySelectorAll("main > section:not(#workspace)").forEach((section) => {
        section.hidden = isWorkspace;
    });
    if (!isWorkspace) return;
    const requestedModule = window.location.hash.slice("#workspace/".length);
    setActiveModule(requestedModule || "dashboard");
}

workspaceNavigation?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-module]");
    if (button) navigateToModule(button.dataset.module);
});

workspaceContent?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-open-module]");
    if (button) navigateToModule(button.dataset.openModule);
});

window.addEventListener("hashchange", () => {
    updateRoute();
    if (workspace?.hidden === false) focusWorkspaceHeading();
});

async function refreshServiceStatus() {
    let apiOrigin;
    try {
        apiOrigin = getApiBaseUrl();
    } catch {
        setServiceStatus(apiStatus, "عنوان API غير صالح", "error");
        setServiceStatus(databaseStatus, "تعذر التحقق", "error");
        if (serviceStatus) serviceStatus.dataset.state = "unavailable";
        if (workspaceApiState) {
            workspaceApiState.dataset.state = "error";
            workspaceApiState.textContent = "عنوان API غير صالح";
        }
        capabilityStates = new Map();
        if (workspace.hidden === false) setActiveModule(activeModule);
        return;
    }

    for (const element of [serviceStatus, workspaceApiState]) {
        if (element) element.dataset.state = "loading";
    }
    if (apiStatus) apiStatus.textContent = "جارٍ التحقق...";
    if (databaseStatus) databaseStatus.textContent = "جارٍ التحقق...";
    if (workspaceApiState) workspaceApiState.textContent = "جارٍ الاتصال...";
    if (refreshStatus) refreshStatus.disabled = true;
    if (workspaceRefresh) workspaceRefresh.disabled = true;

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    try {
        const [readinessResult, capabilitiesResult] = await Promise.allSettled([
            fetchServiceJson(new URL("/api/v1/health/ready", apiOrigin), controller.signal),
            fetchServiceJson(new URL("/api/v1/capabilities", apiOrigin), controller.signal),
        ]);

        const apiAvailable = capabilitiesResult.status === "fulfilled" &&
            capabilitiesResult.value.response.ok &&
            isCapabilitiesPayload(capabilitiesResult.value.body);
        capabilityStates = apiAvailable
            ? new Map(capabilitiesResult.value.body.modules.map((item) => [item.id, item.status]))
            : new Map();

        const readiness = readinessResult.status === "fulfilled"
            ? readinessResult.value
            : null;
        const databaseAvailable = readiness?.response.status === 200 &&
            readiness.body?.status === "ready" &&
            readiness.body?.checks?.database === "available";
        const apiMessage = apiAvailable
            ? "متاحة"
            : capabilitiesResult.status === "rejected"
                ? "تعذر الاتصال"
                : capabilitiesResult.value.response.ok
                    ? "استجابة غير صالحة"
                    : "غير متاحة";
        const databaseMessage = databaseAvailable
            ? "متصلة"
            : readinessResult.status === "rejected"
                ? "تعذر التحقق"
                : "غير متاحة";
        setServiceStatus(apiStatus, apiMessage, apiAvailable ? "available" : "error");
        setServiceStatus(databaseStatus, databaseMessage, databaseAvailable ? "available" : "unavailable");
        if (serviceStatus) serviceStatus.dataset.state = databaseAvailable ? "ready" : "unavailable";
        if (workspaceApiState) {
            workspaceApiState.dataset.state = apiAvailable ? "connected" : "unavailable";
            workspaceApiState.textContent = apiAvailable ? "API متصلة" : apiMessage;
        }
        if (workspace.hidden === false) setActiveModule(activeModule);
    } finally {
        window.clearTimeout(timeout);
        if (refreshStatus) refreshStatus.disabled = false;
        if (workspaceRefresh) workspaceRefresh.disabled = false;
    }
}

function setServiceStatus(element, message, state) {
    if (!element) return;
    element.textContent = message;
    element.dataset.state = state;
}

async function fetchServiceJson(url, signal) {
    const response = await fetch(url, {
        method: "GET",
        cache: "no-store",
        credentials: "omit",
        headers: { Accept: "application/json" },
        signal,
    });
    const body = response.ok || response.status === 503
        ? await response.json()
        : null;
    return { response, body };
}

function isCapabilitiesPayload(value) {
    return value !== null &&
        typeof value === "object" &&
        Array.isArray(value.modules) &&
        value.modules.length > 0 &&
        value.modules.every((module) =>
            module !== null &&
            typeof module === "object" &&
            typeof module.id === "string" &&
            ["available", "partial", "not_implemented"].includes(module.status),
        );
}

refreshStatus?.addEventListener("click", refreshServiceStatus);
workspaceRefresh?.addEventListener("click", refreshServiceStatus);
updateRoute();
void refreshServiceStatus();
