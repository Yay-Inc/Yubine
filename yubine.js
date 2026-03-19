import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

const video = document.getElementById("video");
const videoB = document.getElementById("videoB");
const readButton = document.getElementById("readText");
const displayText = document.getElementById("displayText");
const canvasBuffer = document.getElementById("canvasBuffer");
const canvasDiv = canvasBuffer.parentElement;
const bluetoothInit = document.getElementById("bluetoothOn");
const inputText = document.getElementById("inputText");
const textInput = document.getElementById("textInput");
const pitchPatCanvas = document.getElementById("pitchPatCanvas");
const patDropBox = document.getElementById("patDropBox");
const patDropdown = document.getElementById("patDropdown");
const loading = document.getElementById("loading");
const pitchPatText = document.getElementById("pitchPatText");

let isMouseDown;
let mouseX;
let mouseY;

let pitchDict = null;
let pitchCharacteristic = null;
canvasDiv.style.display = "none";
textInput.style.display = "none";
patDropBox.style.display = "none";
pitchPatCanvas.style.display = "none";
videoB.style.display = "none";

let worker;

Tesseract.createWorker('jpn', 1, {
    logger: () => {}, 
    errorHandler: e => console.error(e)
}).then(w => worker = w);

const waitForEvent = (target, eventType, eventTypeOr) => 
    new Promise(resolve => target.addEventListener(eventType, resolve, { once: true, passive: true }) || target.addEventListener(eventTypeOr, resolve, { once: true, passive: true }));

async function loadPitchDict() {
    try {
        const response = await fetch("./dictionaries/merged.json");
        pitchDict = await response.json();
    } catch (error) {
        console.error("Couldn't load pitch dictionary json", error);
    }
}

let tokenizer = null;

kuromoji.builder({ dicPath: "./dictionaries/tokenFiles/" }).build(function (err, _tokenizer) {
    if (err) {
        console.error("Kuromoji build error:", err);
        return;
    }

    tokenizer = _tokenizer;
    console.log("✅ Tokenizer ready!");
    
    loading.style.display = "none";
    videoB.style.display = "block";
});

function convert(input) {
    let output;
    let reading;
    
    if (!tokenizer) {
        console.log("Tokenizer not ready...");
        return;
    }

    const tokens = tokenizer.tokenize(input);

    // Added "名詞" (Noun) and "形状詞" (Adjectival Noun)
    const mainToken = tokens.find(t =>
        t.pos === "動詞" || 
        t.pos === "形容詞" || 
        t.pos === "名詞" || 
        t.pos === "形状詞"
    );

    if (mainToken) {
        // 1. Get the dictionary base form (like converting "行った" to "行く")
        output = (mainToken.basic_form && mainToken.basic_form !== "*") 
                ? mainToken.basic_form 
                : mainToken.surface_form;
                
        // 2. Safely fetch reading. 
        // Fallback to surface_form if reading/pronunciation are missing (common with Hiragana input)
        let rawReading = mainToken.reading || mainToken.pronunciation || mainToken.surface_form;

        // 3. Always convert the reading to Hiragana for consistency
        reading = wanakana.toHiragana(rawReading);

    } else {
        output = input;
        reading = wanakana.isKana(input) ? wanakana.toHiragana(input) : null;
    }

    console.log(`Input: ${input} -> Output: ${output}, Reading: ${reading}`);
    return [output, reading];
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

async function getPitchPat(word) {
    if (!pitchDict) {
        console.warn("Pitch Pattern Dictionary not loaded yet...");
        return null;
    }

    const patterns = pitchDict[word];

    if (patterns && patterns.length > 0) {
        if (patterns.length > 1) {
            displayText.textContent = "Multiple pitch accents found:"
            while (patDropdown.length > 1) {
                patDropdown.remove(patDropdown.options.length - 1);
            }
            patDropBox.style.display = "block";

            let seen = [];

            for (let i = 0; i < patterns.length; i++) {
                const patOption = patterns[i].join("");

                if (!seen.includes(patOption)) {
                    seen.push(patOption);

                    const newOption = document.createElement("option");
                    newOption.value = i;
                    newOption.textContent = patOption;
                    patDropdown.appendChild(newOption);
                }
            }

            while (true) {
                await waitForEvent(patDropdown, "change");
                if (patDropdown.value !== ".") {
                    break;
                }
            }
            patDropBox.style.display = "none";
            const v = patDropdown.value;
            return patterns[v];
        } else {
            return patterns[0];
        }
    }

    return "Word not found";
}

function drawPitPat(pat) {
    const pc = pitchPatCanvas.getContext('2d');

    pitchPatCanvas.width = pitchPatCanvas.clientWidth;
    pitchPatCanvas.height = pitchPatCanvas.clientHeight;

    canvasBuffer.style.display = "revert";

    pc.clearRect(0, 0, canvasBuffer.width, canvasBuffer.height);

    let prog = 20;
    let ht = (pat[0] === "L") ? 60 : 20;
    pc.beginPath();
    pc.strokeStyle = "white";
    pc.lineWidth = 2;
    pc.moveTo(prog, ht);

    for (let i = 1; i < pat.length; i++) {
        prog += 60;
        ht = (pat[i] === "L") ? 60 : 20;
        pc.lineTo(prog, ht);
    }
    pc.stroke();
    
    prog = 20;

    for (let i = 0; i < pat.length; i++) {
        ht = (pat[i] === "L") ? 60 : 20;
        
        pc.beginPath();
        pc.fillStyle = (i === pat.length - 1) ? "rgb(0, 13, 59)" : "white";
        pc.strokeStyle = "white";
        pc.lineWidth = 2;
        pc.arc(prog, ht, 5, 0, 2 * Math.PI);
        pc.fill();
        pc.stroke();

        prog += 60;
    }
}

async function readText(inputWord) {
    if (!worker) return;
    let rawWord;
    
    pitchPatCanvas.style.display = "none";
    pitchPatCanvas.textContent = "";
    patDropBox.style.display = "none";
    textInput.value = "";

    if (inputWord === null) {
        canvasDiv.style.display = "revert";
        
        const W = canvasDiv.clientWidth;
        const H = canvasDiv.clientHeight;
        canvasBuffer.width = W;
        canvasBuffer.height = H;

        const ctx = canvasBuffer.getContext('2d');

        const videoW = video.videoWidth;
        const videoH = video.videoHeight;
        const scaleX = W / videoW;
        const scaleY = H / videoH;
        const scale = Math.max(scaleX, scaleY);
        const drawW = videoW * scale;
        const drawH = videoH * scale;
        let sx = 0, sy = 0, sw = videoW, sh = videoH;

        if (scaleX > scaleY) {
            // Video is taller, crop top/bottom
            sy = (drawH - H) / (2 * scale);
            sh = H / scale;
        } else {
            // Video is wider, crop left/right
            sx = (drawW - W) / (2 * scale);
            sw = W / scale;
        }

        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, W, H);

        ctx.filter = 'none';
        canvasBuffer.style.display = "block";
        canvasBuffer.style.width = '100%';
        canvasBuffer.style.height = '100%';
        canvasBuffer.style.maxWidth = '640px';
        pitchPatCanvas.style.display = "none";
        
        const frame = ctx.getImageData(0, 0, canvasBuffer.width, canvasBuffer.height);

        ctx.strokeStyle = "red";
        ctx.lineWidth = 2;
        ctx.font = "12px Arial";
        ctx.fillStyle = "red";
        
        canvasBuffer.style.touchAction = "none";
        
        let rect;

        while (true) {
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
            rect = {
                top: Math.floor(Math.min(startY, mouseY)),
                left: Math.floor(Math.min(startX, mouseX)),
                height: Math.floor(Math.abs(startY - mouseY)),
                width: Math.floor(Math.abs(startX - mouseX))
            }

            if (rect.width < 5 || rect.height < 5) {
                displayText.textContent = "Selection too small. Please drag to select a box.";
                continue;
            } else {
                break;
            }
        }

        canvasBuffer.style.touchAction = "auto";

        const { data } = await worker.recognize(canvasBuffer, { rectangle: rect });
        
        rawWord = data.text.replace(/\s+/g, "");

        data.words.forEach(word => {
            const { x0, y0, x1, y1 } = word.bbox;
            const width = x1 - x0;
            const height = y1 - y0;

            ctx.strokeRect(x0, y0, width, height);
            ctx.fillText(word.text, x0, y0 > 20 ? y0 - 5 : y0 + 20);
        });
    } else {
        canvasDiv.style.display = "none";
        rawWord = inputWord;
    }
    
    const [word, reading] = convert(rawWord);
    
    let output = word;

    if (word.length === 0) {
        displayText.textContent = "No text detected.";
        pitchPatText.textContent = "";
        return;
    }

    if (!pitchDict) {
        displayText.textContent = "Loading pitch dictionary...";
        await loadPitchDict();
    }
    
    const patList = await getPitchPat(word);
    if (patList && patList !== "Word not found") {
        
        const pat = patList.join("");
        pitchPatCanvas.style.display = "revert";
        drawPitPat(pat);
        pitchPatText.textContent =  reading + "[が]";

        if (pitchCharacteristic) {
        const encoder = new TextEncoder();
        const data = encoder.encode(pat);
        pitchCharacteristic.writeValue(data)
            .then(() => console.log("Sent to device: " + pat))
            .catch(err => console.error("Write failed: ", err));
    }
    } else {
        output += `\n\n<br>Pitch accent for this word not found in dictionary`;
        canvasDiv.style.display = "none";
        pitchPatCanvas.style.display = "none";
        pitchPatText.textContent = "";
    }

    displayText.innerHTML = output;
}

bluetoothInit.addEventListener('click', function(event) {
    const SerUUID = '19b10000-e8f2-537e-4f6c-d104768a1214';
    const ChaUUID = '19b10001-e8f2-537e-4f6c-d104768a1214';
    
    navigator.bluetooth.requestDevice({
    filters: [{
        name: 'Yubine-Device'
    }],
    optionalServices: [SerUUID] // Required to access service later.
})
.then(device => device.gatt.connect())
.then(server => server.getPrimaryService(SerUUID))
.then(service => service.getCharacteristic(ChaUUID))
.then(characteristic => {
    pitchCharacteristic = characteristic;
})
.catch(error => { console.error(error); });
});

readButton.addEventListener('click', () => readText(null));
inputText.addEventListener('click', async (e) => {
    textInput.style.display = "block";
    inputText.style.display = "none";
    textInput.focus();
    await waitForEvent(textInput, 'change');
    readText(textInput.value);
    textInput.style.display = "none";
    inputText.style.display = "block";
});

function updatePos(e) {
    const rect = canvasBuffer.getBoundingClientRect();

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    

    mouseX = (clientX - rect.left) * (canvasBuffer.width / rect.width);
    mouseY = (clientY - rect.top) * (canvasBuffer.height / rect.height);
}


canvasBuffer.addEventListener('mousedown', (e) => { isMouseDown = true; updatePos(e); });
canvasBuffer.addEventListener('mousemove', (e) => { if (isMouseDown) updatePos(e); }); 
window.addEventListener('mouseup', () => isMouseDown = false);

canvasBuffer.addEventListener('touchstart', (e) => { 
    isMouseDown = true; 
    updatePos(e); 
}, { passive: true });

canvasBuffer.addEventListener('touchmove', (e) => { 
    if (isMouseDown) {
        updatePos(e);
    }
}, { passive: true });

canvasBuffer.addEventListener('touchend', () => isMouseDown = false);

loadPitchDict();
turnOnCam();