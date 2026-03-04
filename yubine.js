import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

const video = document.getElementById("video");
const flipButton = document.getElementById("flipButton");
const readButton = document.getElementById("readText");
const clearCanvas = document.getElementById("clearCanvas");
const displayText = document.getElementById("displayText");
const canvasBuffer = document.getElementById("canvasBuffer");
const toggleCamera = document.getElementById("toggleCamera");
const pitchPatCanvas = document.getElementById("pitchPatCanvas");

let isMouseDown;
let mouseX;
let mouseY;

let pitchDict = null;
canvasBuffer.style.display = "none";

let worker;

Tesseract.createWorker('jpn', 1, {
    logger: () => {}, 
    errorHandler: e => console.error(e)
}).then(w => worker = w);

const waitForEvent = (target, eventType, eventTypeOr) => 
    new Promise(resolve => target.addEventListener(eventType, resolve, { once: true }));

async function loadPitchDict() {
    try {
        const response = await fetch("merged.json");
        pitchDict = await response.json();
    } catch (error) {
        console.error("Couldn't load pitch dictionary json", error);
    }
}

function turnOnCam() {
    if ('mediaDevices' in navigator && 'getUserMedia' in navigator.mediaDevices) {
        navigator.mediaDevices.getUserMedia({ video: {facingMode: "environment" } })
            .then(function(stream) {
                video.srcObject = stream;
            })
            .catch(function(err) {
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

function getPitchPat(word) {
    if (!pitchDict) {
        console.warn("Pitch Pattern Dictionary not loaded yet...");
        return null;
    }

    const patterns = pitchDict[word];

    if (patterns && patterns.length > 0) {
        return patterns;
    }

    return "Word not found";
}

function drawPitPat(pat) {
    const pc = pitchPatCanvas.getContext('2d');

    pitchPatCanvas.width = pitchPatCanvas.clientWidth;
    pitchPatCanvas.height = pitchPatCanvas.clientHeight;

    canvasBuffer.style.display = "revert";

    pc.clearRect(0, 0, canvasBuffer.width, canvasBuffer.height);

    let prog = 10;
    let ht = (pat[0] === "L") ? 60 : 20;
    pc.beginPath();
    pc.strokeStyle = "black";
    pc.lineWidth = 2;
    pc.moveTo(prog, ht);

    for (let i = 1; i < pat.length; i++) {
        prog += 60;
        ht = (pat[i] === "L") ? 60 : 20;
        pc.lineTo(prog, ht);
    }
    pc.stroke();
    
    prog = 10;

    for (let i = 0; i < pat.length; i++) {
        ht = (pat[i] === "L") ? 60 : 20;
        
        pc.beginPath();
        pc.fillStyle = (i === pat.length - 1) ? "#b0e0e6" : "black";
        pc.strokeStyle = "black";
        pc.lineWidth = 2;
        pc.arc(prog, ht, 5, 0, 2 * Math.PI);
        pc.fill();
        pc.stroke();

        prog += 60;
    }
}

async function readText() {
    if (!worker) return;

    canvasBuffer.width = video.videoWidth;
    canvasBuffer.height = video.videoHeight;

    const ctx = canvasBuffer.getContext('2d');

    ctx.filter = 'grayscale(1) contrast(2) brightness(1)';
    
    ctx.drawImage(video, 0, 0, canvasBuffer.width, canvasBuffer.height);


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
            ctx.putImageData(frame, 0, 0); 
            ctx.strokeStyle = "red";
            ctx.strokeRect(startX, startY, mouseX - startX, mouseY - startY);
            
            if (isMouseDown) {
                requestAnimationFrame(drawSelection);
            } else {
                resolve(); 
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
    
    const word = data.text.replace(/\s+/g, "");
    let output = word;

    if (word.length === 0) {
        displayText.textContent = "No text detected.";
        return;
    }

    if (!pitchDict) {
        displayText.textContent = "Loading pitch dictionary...";
        await loadPitchDict();
    }
    
    const patList = getPitchPat(word);
    if (patList && patList !== "Word not found") {
        
        const pat = patList[0].join("");
        output += `\n\n<br>Pitch accent: `;
        drawPitPat(pat);
    } else {
        output += `\n\n<br>Pitch accent for this word not found in dictionary`;
        canvasBuffer.style.display = "none";
    }

    displayText.innerHTML = output;

    data.words.forEach(word => {
        const { x0, y0, x1, y1 } = word.bbox;
        const width = x1 - x0;
        const height = y1 - y0;

        ctx.strokeRect(x0, y0, width, height);
        ctx.fillText(word.text, x0, y0 > 20 ? y0 - 5 : y0 + 20);
    });
}

toggleCamera.addEventListener('click', turnOnCam);
flipButton.addEventListener('click', flipVideo);
readButton.addEventListener('click', readText);
clearCanvas.addEventListener('click', function() {
    canvasBuffer.style.display = "none";
});
document.querySelector('html').addEventListener("keydown", event => {if (event.key == 'g') readText()});

function updatePos(e) {
    const rect = canvasBuffer.getBoundingClientRect();

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    

    mouseX = (clientX - rect.left) * (canvasBuffer.width / rect.width);
    mouseY = (clientY - rect.top) * (canvasBuffer.height / rect.height);
}


canvasBuffer.addEventListener('mousedown', (e) => { isMouseDown = true; updatePos(e); });
canvasBuffer.addEventListener('mousemove', (e) => { if (isMouseDown) updatePos(e); });
canvasBuffer.addEventListener('mouseup', () => isMouseDown = false);

canvasBuffer.addEventListener('touchstart', (e) => { 
    isMouseDown = true; 
    updatePos(e); 
}, { passive: false });

canvasBuffer.addEventListener('touchmove', (e) => { 
    if (isMouseDown) {
        updatePos(e);
        e.preventDefault();
    }
}, { passive: false });

canvasBuffer.addEventListener('touchend', () => isMouseDown = false);

loadPitchDict();
turnOnCam();