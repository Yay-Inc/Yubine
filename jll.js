import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

const video = document.getElementById("video");
const flipButton = document.getElementById("flipButton");
const readButton = document.getElementById("readText");
const langButton = document.getElementById("langButton");
const clearCanvas = document.getElementById("clearCanvas");
const displayText = document.getElementById("displayText");
const canvasBuffer = document.getElementById("canvasBuffer");
const toggleCamera = document.getElementById("toggleCamera");

let isMouseDown;
let mouseX;
let mouseY;

let jpnese = false;
let word;
let worker;

Tesseract.createWorker('eng', 1, {
    logger: () => {}, 
    errorHandler: e => console.error(e)
}).then(w => worker = w);

const waitForEvent = (target, eventType, eventTypeOr) => 
    new Promise(resolve => target.addEventListener(eventType, resolve, { once: true }));

let translator = null;

async function getTranslator() {
    if (!translator) {
        displayText.textContent = "Loading translation model (first time takes ~10s)...";

        // env.allowLocalModels = true;
        // env.localModelPath = '/models/';
        // env.useBrowserCache = true;
        // env.remoteHost = null;
        // env.remotePathTemplate = null;

        try {
            translator = await pipeline(
                'translation',
                'Xenova/opus-mt-ja-en',
                {
                device: 'wasm',
                dtype: 'q8'
                }
            );
        } catch (err) {
            console.error("Pipeline failed:", err);
            displayText.textContent = "Model load failed (CORS).";
        }
    }
    console.log(translator);
    return translator;
}

function turnOnCam() {
    // Check if the browser supports the mediaDevices API
    if ('mediaDevices' in navigator && 'getUserMedia' in navigator.mediaDevices) {
        // Request access to the camera (video only, no audio)
        navigator.mediaDevices.getUserMedia({ video: {facingMode: "environment" } })
            .then(function(stream) {
                // Success: Attach the stream to the video element
                video.srcObject = stream;
            })
            .catch(function(err) {
                // Error handling (e.g., user denied permission, no camera found)
                console.error("Error accessing the camera: " + err);
            });
    } else {
        console.error("getUserMedia not supported in this browser.");
    }
}

function flipVideo() {
    if (video.style.transform == "scaleX(-1)") {
        video.style.transform = "scaleX(1)";
    } else {
        video.style.transform = "scaleX(-1)";
    }
}

async function readText() {
    if (!worker) return;

    canvasBuffer.width = video.videoWidth;
    canvasBuffer.height = video.videoHeight;

    const ctx = canvasBuffer.getContext('2d');
    // 1. Apply CSS-like filters directly to the canvas
    // threshold is simulated by high contrast and grayscale
    ctx.filter = 'grayscale(1) contrast(2) brightness(1)';
    
    // 2. Draw the video frame (it will be filtered automatically)
    ctx.drawImage(video, 0, 0, canvasBuffer.width, canvasBuffer.height);

    // 3. Reset filter so bounding boxes aren't distorted/weird
    ctx.filter = 'none';
    canvasBuffer.style.display = "revert";
    
    const frame = ctx.getImageData(0, 0, canvasBuffer.width, canvasBuffer.height);

    ctx.strokeStyle = "red";
    ctx.lineWidth = 2;
    ctx.font = "12px Arial";
    ctx.fillStyle = "red";
    
    displayText.textContent = "Click and drag on the canvas to select text...";
    await Promise.race([
        waitForEvent(canvasBuffer, 'touchstart'),
        waitForEvent(canvasBuffer, 'mousedown')
    ]);

    const startX = mouseX;
    const startY = mouseY;

    await new Promise(resolve => {
        function drawSelection() {
            ctx.putImageData(frame, 0, 0); // Restore original frame
            ctx.strokeStyle = "red";
            ctx.strokeRect(startX, startY, mouseX - startX, mouseY - startY);
            
            if (isMouseDown) {
                requestAnimationFrame(drawSelection);
            } else {
                resolve(); // Mouse released!
            }
        }
        drawSelection();
    });
    const rect = {
        top: Math.floor(Math.min(startY, mouseY)),
        left: Math.floor(Math.min(startX, mouseX)),
        height: Math.floor(Math.abs(startY - mouseY)),
        width: Math.floor(Math.abs(startX - mouseX))
    }

    if (rect.width < 5 || rect.height < 5) {
        displayText.textContent = "Selection too small. Please drag to select a box.";
        return;
    }

    const { data } = await worker.recognize(canvasBuffer, { rectangle: rect });
    
    word = data.text.replaceAll(" ", "");
    
    if (jpnese && word.length > 0) {
        const t = await getTranslator();
        if (!t) {
            displayText.textContent = "Translator failed to load.";
            return;
        }

        const translation = await t(word, {
            num_beams: 1,
        });

        word = `${word}\n---\n${translation[0].translation_text}`;
    }

    displayText.textContent = word;
    
    // 3. Draw bounding boxes for each word
    data.words.forEach(word => {
        const { x0, y0, x1, y1 } = word.bbox;
        const width = x1 - x0;
        const height = y1 - y0;

        // Draw the rectangle
        ctx.strokeRect(x0, y0, width, height);

        // Optional: Label the box with the detected text
        ctx.fillText(word.text, x0, y0 > 20 ? y0 - 5 : y0 + 20);
    });
}

async function changeLanguage() {
    if (jpnese == false) {
        if (worker) await worker.terminate();
        worker = await Tesseract.createWorker("jpn");
        langButton.textContent = "Switch to English";
        jpnese = true;
    } else {
        if (worker) await worker.terminate();
        worker = await Tesseract.createWorker("eng");
        langButton.textContent = "Switch to Japanese";
        jpnese = false;
    }
}

toggleCamera.addEventListener('click', turnOnCam);
langButton.addEventListener('click', changeLanguage);
flipButton.addEventListener('click', flipVideo);
readButton.addEventListener('click', readText);
clearCanvas.addEventListener('click', function() {
    canvasBuffer.style.display = "none";
});
document.querySelector('html').addEventListener("keydown", event => {if (event.key == 'g') readText()});

function updatePos(e) {
    const rect = canvasBuffer.getBoundingClientRect();
    // Touch events use e.touches[0], Mouse uses e directly
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    
    // Scale coordinates to match actual canvas internal resolution
    mouseX = (clientX - rect.left) * (canvasBuffer.width / rect.width);
    mouseY = (clientY - rect.top) * (canvasBuffer.height / rect.height);
}

// Mouse
canvasBuffer.addEventListener('mousedown', (e) => { isMouseDown = true; updatePos(e); });
canvasBuffer.addEventListener('mousemove', (e) => { if (isMouseDown) updatePos(e); });
canvasBuffer.addEventListener('mouseup', () => isMouseDown = false);

// Touch
canvasBuffer.addEventListener('touchstart', (e) => { 
    isMouseDown = true; 
    updatePos(e); 
}, { passive: false });

canvasBuffer.addEventListener('touchmove', (e) => { 
    if (isMouseDown) {
        updatePos(e);
        e.preventDefault(); // Prevents the page from scrolling while you draw
    }
}, { passive: false });

canvasBuffer.addEventListener('touchend', () => isMouseDown = false);