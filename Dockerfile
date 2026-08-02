# 1. Use the official pre-built Verilator 5 image as the base
# This completely skips the 15-minute C++ compilation step
FROM verilator/verilator:5.026

# 2. Switch to the root user to install Node.js and dependencies
USER root

# 3. Install Node.js (v18) and standard build tools needed for runtime
RUN apt-get update && apt-get install -y curl make g++ \
    && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# 4. Create and set the working directory for the API
WORKDIR /usr/src/app

# 5. Copy package files and install Node.js dependencies
COPY package*.json ./
RUN npm install

# 6. Copy the server code
COPY server.js ./

# 7. IMPORTANT: Override the default Verilator entrypoint
# The official image defaults to running 'verilator', we need it to run Node
ENTRYPOINT []

# 8. Expose the API port
EXPOSE 3000

# 9. Start the LogicSilicon Unified API
CMD [ "node", "server.js" ]
