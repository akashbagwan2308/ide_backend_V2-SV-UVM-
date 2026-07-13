// ... existing code ...
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
// 3. SECURE SIMULATION (SLANG + VERILATOR)
// ==========================================
app.post('/run', authenticateToken, (req, res) => {
    const code = req.body.code;
    if (!code) return res.status(400).json({ error: "No Verilog code provided." });

    const runId = Date.now().toString() + Math.floor(Math.random() * 1000);
    const runDir = path.join('/tmp', runId);
    fs.mkdirSync(runDir, { recursive: true });

    const filePath = path.join(runDir, 'design.sv');
    fs.writeFileSync(filePath, code);

    // Phase 1: Fast Linting & Parsing via Slang
    exec(`slang ${filePath}`, { timeout: 5000, cwd: runDir }, (slangErr, slangStdout, slangStderr) => {
        if (slangErr) {
            fs.rmSync(runDir, { recursive: true, force: true });
            return res.json({ status: "error", output: "--- SLANG SYNTAX ERROR ---\n" + (slangStderr || slangStdout || slangErr.message) });
        }

        // Phase 2: Compile & Execute with Verilator 5 + Z3
        // --binary builds the executable, --trace enables VCD, --timing enables #delays, -o forces output name
        const verilatorCmd = `verilator --binary --trace --assert --timing -Wno-fatal -o sim_exec ${filePath}`;
        
        exec(verilatorCmd, { timeout: 25000, cwd: runDir }, (verErr, verStdout, verStderr) => {
            if (verErr) {
                fs.rmSync(runDir, { recursive: true, force: true });
                return res.json({ status: "error", output: "--- VERILATOR COMPILE ERROR ---\n" + (verStderr || verStdout || verErr.message) });
            }

            // Phase 3: Run the Compiled Executable
            exec(`./obj_dir/sim_exec`, { timeout: 15000, cwd: runDir }, (runErr, runStdout, runStderr) => {
                let vcdData = null;
                let vcdJson = null;

                try {
                    const files = fs.readdirSync(runDir);
                    const vcdFile = files.find(f => f.endsWith('.vcd'));
                    if (vcdFile) {
                        vcdData = fs.readFileSync(path.join(runDir, vcdFile), 'utf8');
                        vcdJson = parseVCDToJSON(vcdData); // Parse directly to JSON!
                    }
                } catch (err) {
                    console.error("VCD Read Error:", err);
                }

                fs.rmSync(runDir, { recursive: true, force: true });

                if (runErr) return res.json({ status: "error", output: runStderr || runStdout || runErr.message });

                return res.json({ status: "success", output: runStdout, vcd: vcdData, vcdJson: vcdJson });
            });
        });
    });
});

// ==========================================
// 4. SECURE SYNTHESIS (YOSYS)
// ==========================================
// ... existing code ...
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Unified LogicSilicon Backend (Verilator + Slang + Z3 + Yosys) running on port ${PORT}`);
});