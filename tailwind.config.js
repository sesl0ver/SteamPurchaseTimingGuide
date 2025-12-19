/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        "./templates/**/*.twig",
        "./public/assets/**/*.js",   // 바닐라 JS에서 class 조작하면 포함 권장
        "./src/**/*.php",            // PHP에서 class 문자열을 만드는 경우 대비(있으면)
    ],
    theme: { extend: {} },
    plugins: [],
};
