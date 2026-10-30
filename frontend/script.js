/* =================================
   ZIBEN NOVA - INTERACTIONS
================================= */

// 1. Mobile Navigation

const menuToggle = document.getElementById("menuToggle");
const navLinks = document.getElementById("navLinks");

menuToggle.addEventListener("click", function () {

    const isOpen = navLinks.classList.toggle("active");

    menuToggle.setAttribute("aria-expanded", isOpen);
    menuToggle.textContent = isOpen ? "×" : "☰";

});


// Close menu after clicking a navigation link

const navigationLinks = document.querySelectorAll(".nav-links a");

navigationLinks.forEach(function (link) {

    link.addEventListener("click", function () {

        navLinks.classList.remove("active");

        menuToggle.setAttribute("aria-expanded", "false");
        menuToggle.textContent = "☰";

    });

});


// 2. AI Product Demo

const aiForm = document.getElementById("aiForm");
const productInput = document.getElementById("productInput");
const aiResult = document.getElementById("aiResult");
const analyzeButton = aiForm.querySelector("button");


aiForm.addEventListener("submit", function (event) {

    event.preventDefault();

    const productName = productInput.value.trim();

    // Check input

    if (productName.length === 0) {

        productInput.focus();
        return;

    }

    // Loading state

    analyzeButton.disabled = true;
    analyzeButton.textContent = "جاري تجهيز النموذج...";

    aiResult.textContent = "";

    const loadingMessage = document.createElement("p");

    loadingMessage.className = "result-text";
    loadingMessage.textContent =
        "ZIBEN Nova Demo Engine is processing your product...";

    aiResult.appendChild(loadingMessage);


    // Simulated analysis

    setTimeout(function () {

        aiResult.textContent = "";

        const title = document.createElement("h3");

        title.className = "result-title";
        title.textContent = "✦ Product Analysis Preview";


        const product = document.createElement("p");

        product.className = "result-text";
        product.textContent = "المنتج: " + productName;


        const strategy = document.createElement("p");

        strategy.className = "result-text";
        strategy.textContent =
            "الخطوة الأولى: تحديد الجمهور المستهدف واحتياجاته.";


        const marketing = document.createElement("p");

        marketing.className = "result-text";
        marketing.textContent =
            "الخطوة الثانية: بناء عرض تسويقي يوضح قيمة المنتج.";


        const automation = document.createElement("p");

        automation.className = "result-text";
        automation.textContent =
            "الخطوة الثالثة: إعداد تصور لأتمتة استقبال العملاء والطلبات.";


        const note = document.createElement("p");

        note.className = "result-text";
        note.textContent =
            "ملاحظة: هذه نتيجة تجريبية محلية وليست تحليلاً حقيقياً بواسطة AI API.";


        aiResult.append(
            title,
            product,
            strategy,
            marketing,
            automation,
            note
        );


        // Restore button

        analyzeButton.disabled = false;
        analyzeButton.innerHTML = 'تحليل المنتج <span>✦</span>';

    }, 1200);

});


// 3. Current Year in Footer

const footerText = document.querySelector(".footer p");

footerText.textContent =
    "© " + new Date().getFullYear() +
    " ZIBEN Nova. All Rights Reserved.";