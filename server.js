const express = require('express');
const cors = require('cors');
const fs = require('fs');
const { exec } = require('child_process');
const path = require('path');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors()); 
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || "logicsilicon_secure_jwt_key_2024";
const GOOGLE_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbzhtk4rISUDJvMb3nLzJq2CBY5cVnm9kAnL_fuW77MLOkoR0-_dS0nKtmCwBjpD3mpAnQ/exec";

// ==========================================
// VCD TO JSON PARSER (For Logic Analyzer)
// ==========================================
function parseVCDToJSON(vcdText) {
    if (!vcdText) return null;
    const lines = vcdText.split('\n');
    const symbolMap = {}; 
    const timeline = [];
    let currentState = {};
    let currentScope = [];
    let currentTime = null;

    lines.forEach(line => {
        line = line.trim();
        if (line.startsWith('$scope')) {
            const parts = line.split(/\s+/);
            if (parts.length >= 3) currentScope.push(parts[2]);
        } else if (line.startsWith('$upscope')) {
            currentScope.pop();
        } else if (line.startsWith('$var')) {
            const parts = line.split(/\s+/);
            if(parts.length >= 5) {
                const symbol = parts[3];
                const name = parts[4];
                const fullName = currentScope.length > 0 ? [...currentScope, name].join('.') : name;
                symbolMap[symbol] = fullName;
                currentState[fullName] = 'x';
            }
        } else if (line.startsWith('#')) {
            const time = parseInt(line.substring(1));
            if (currentTime !== null && time !== currentTime) {
                timeline.push({ time: currentTime, state: { ...currentState } });
            }
            currentTime = time;
        } else if (line.match(/^[01xXzZ]/) && !line.startsWith('$')) {
            const val = line[0];
            const sym = line.substring(1);
            if (symbolMap[sym]) currentState[symbolMap[sym]] = val;
        } else if ((line.startsWith('b') || line.startsWith('B')) && !line.startsWith('$')) {
            const parts = line.split(' ');
            if (parts.length === 2) {
                const val = parts[0].substring(1);
                const sym = parts[1];
                if (symbolMap[sym]) currentState[symbolMap[sym]] = val;
            }
        }
    });

    if (currentTime !== null) {
        timeline.push({ time: currentTime, state: { ...currentState } });
    }
    return timeline;
}

// ==========================================
// 1. AUTHENTICATION ENDPOINT
// ==========================================
app.post('/login', async (req, res) => {
    const { email, authString, role } = req.body;
    try {
        const googleResponse = await fetch(GOOGLE_WEB_APP_URL, {
            method: 'POST', headers: {'Content-Type': 'text/plain'}, 
            body: JSON.stringify({ action: 'login', role: role || 'student', email: email, authString: authString })
        });
        const data = await googleResponse.json();

        if (data.status === 'success') {
            const token = jwt.sign({ email: email, role: role || 'student' }, JWT_SECRET, { expiresIn: '24h' });
            res.json({ status: 'success', token: token, user: { email, role: role || 'student' } });
        } else {
            res.status(401).json({ status: 'error', message: 'Invalid credentials.' });
        }
    } catch (error) {
        console.error("Auth Error:", error);
        res.status(500).json({ status: 'error', message: 'Internal server error during authentication.' });
    }
});

// ==========================================
// 2. SECURITY MIDDLEWARE
// ==========================================
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ status: "error", output: "Access Denied: No JWT Token Provided." });
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ status: "error", output: "Access Denied: Invalid or Expired Token." });
        req.user = user;
        next();
    });
}

// ==========================================
// 3. SECURE SIMULATION (VERILATOR 5 NATIVE)
// ==========================================
app.post('/run', authenticateToken, (req, res) => {
    const code = req.body.code;
    if (!code) return res.status(400).json({ error: "No Verilog/SystemVerilog code provided." });

    const runId = Date.now().toString() + Math.floor(Math.random() * 1000);
    const runDir = path.join('/tmp', runId);
    fs.mkdirSync(runDir, { recursive: true });

    // The frontend bundles design and TB into a single payload
    const filePath = path.join(runDir, 'project.sv');
    fs.writeFileSync(filePath, code);

    // Verilator 5 flags:
    // --binary: Auto-generates the C++ main loop and compiles an executable
    // --timing: Enables support for #delays and @(events)
    // --trace: Prepares the binary for VCD dumping
    // -Wno-fatal: Prevents non-critical warnings from halting compilation
    const compileCmd = `verilator --binary --timing --trace -Wno-fatal -o sim_bin project.sv`;

    exec(compileCmd, { timeout: 30000, cwd: runDir }, (compileErr, compileStdout, compileStderr) => {
        if (compileErr) {
            fs.rmSync(runDir, { recursive: true, force: true });
            // Verilator outputs errors to stderr
            return res.json({ status: "error", output: compileStderr || compileStdout || compileErr.message });
        }

        // Execute the compiled simulation binary
        exec(`./sim_bin`, { timeout: 15000, cwd: runDir }, (runErr, runStdout, runStderr) => {
            let vcdData = null;
            let vcdJson = null;

            try {
                const files = fs.readdirSync(runDir);
                const vcdFile = files.find(f => f.endsWith('.vcd'));
                if (vcdFile) {
                    vcdData = fs.readFileSync(path.join(runDir, vcdFile), 'utf8');
                    vcdJson = parseVCDToJSON(vcdData);
                }
            } catch (err) {
                console.error("VCD Read Error:", err);
            }

            fs.rmSync(runDir, { recursive: true, force: true });

            if (runErr) {
                return res.json({ status: "error", output: runStderr || runStdout || runErr.message });
            }

            return res.json({ status: "success", output: runStdout, vcd: vcdData, vcdJson: vcdJson });
        });
    });
});

// ==========================================
// 4. SECURE SYNTHESIS (YOSYS)
// ==========================================
app.post('/api/synthesize', authenticateToken, (req, res) => {
    const verilogCode = req.body.code;
    if (!verilogCode) return res.status(400).json({ error: "No Verilog code provided" });

    const runId = Date.now().toString() + Math.floor(Math.random() * 1000);
    const vFile = path.join('/tmp', `temp_${runId}.sv`);
    const jsonFile = path.join('/tmp', `temp_${runId}.json`);

    try {
        fs.writeFileSync(vFile, verilogCode);
        const yosysCommand = `yosys -p "read_verilog -sv ${vFile}; prep; write_json ${jsonFile}"`;

        exec(yosysCommand, { timeout: 15000 }, (error, stdout, stderr) => {
            if (fs.existsSync(vFile)) fs.unlinkSync(vFile);

            if (error) {
                if (fs.existsSync(jsonFile)) fs.unlinkSync(jsonFile);
                return res.status(500).json({ error: "Compilation failed", details: stderr || error.message });
            }

            if (fs.existsSync(jsonFile)) {
                const netlistData = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
                res.json({ status: "success", netlist: netlistData });
                fs.unlinkSync(jsonFile);
            } else {
                res.status(500).json({ error: "Yosys failed to generate JSON netlist." });
            }
        });
    } catch (err) {
        if (fs.existsSync(vFile)) fs.unlinkSync(vFile);
        if (fs.existsSync(jsonFile)) fs.unlinkSync(jsonFile);
        res.status(500).json({ error: "Server error during synthesis prep." });
    }
});

// ==========================================
// 5. SECURED GITHUB UPLOAD ENDPOINT
// ==========================================
app.post('/save-github', authenticateToken, async (req, res) => {
    const { filename, fileBase64, owner, repo, pat } = req.body;
    if (!filename || !fileBase64 || !owner || !repo || !pat) {
        return res.status(400).json({ status: 'error', message: 'Missing required GitHub parameters.' });
    }

    try {
        const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${filename}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${pat}`,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'LogicSilicon-IDE'
            },
            body: JSON.stringify({
                message: `Auto-saved ${filename} via LogicSilicon Playground`,
                content: fileBase64
            })
        });

        const data = await response.json();
        if (response.ok) {
            res.json({ status: 'success', url: data.content.html_url });
        } else {
            res.status(response.status).json({ status: 'error', message: data.message });
        }
    } catch (error) {
        console.error("GitHub Upload Error:", error);
        res.status(500).json({ status: 'error', message: 'Internal server error while connecting to GitHub.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Unified LogicSilicon Backend (Verilator + Yosys) running on port ${PORT}`);
});
