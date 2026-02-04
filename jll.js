const video = document.getElementById("video");
const flipButton = document.getElementById("flipButton");
const readButton = document.getElementById("readText");
const langButton = document.getElementById("langButton");
const displayText = document.getElementById("displayText");
const canvasBuffer = document.getElementById("canvasBuffer");

let jap = false;

let worker;
Tesseract.createWorker('eng', 2).then(w => worker = w);

// Check if the browser supports the mediaDevices API
if ('mediaDevices' in navigator && 'getUserMedia' in navigator.mediaDevices) {
    // Request access to the camera (video only, no audio)
    navigator.mediaDevices.getUserMedia({ video: true, audio: false })
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

    const { data } = await worker.recognize(canvasBuffer, { rectangle: { top: 220, left: 245, height: 40, width: 150 }});
    displayText.textContent = data.text;
    
    // 3. Draw bounding boxes for each word
    ctx.strokeStyle = "red";
    ctx.lineWidth = 2;
    ctx.font = "16px Arial";
    ctx.fillStyle = "red";

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
    if (jap == false) {
        await worker.reinitialize('jpn');
        langButton.textContent = "Switch to English";
        jap = true;
    } else {
        await worker.reinitialize('eng');
        langButton.textContent = "Switch to Japanese";
        jap = false;
    }

}

langButton.addEventListener('click', changeLanguage);
flipButton.addEventListener('click', flipVideo);
readButton.addEventListener('click', readText);
document.querySelector('html').addEventListener("keydown", event => {if (event.key == 'g') readText()});
