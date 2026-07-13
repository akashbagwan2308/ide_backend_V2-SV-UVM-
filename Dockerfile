# Use a robust Debian-based Node image for complex C++ compilation
FROM node:20-bookworm

# Install build dependencies for Slang, Verilator, Z3, and Yosys
RUN apt-get update && apt-get install -y \
    git build-essential python3 flex bison \
    libz3-dev z3 yosys autoconf pkg-config wget \
    && rm -rf /var/lib/apt/lists/*

# Install modern CMake (Slang requires >= 3.28, Bookworm has 3.25)
RUN wget -qO- "https://github.com/Kitware/CMake/releases/download/v3.29.3/cmake-3.29.3-linux-x86_64.tar.gz" | tar --strip-components=1 -xz -C /usr/local

# Build Slang (for ultra-fast IEEE 1800 parsing and type-checking)
RUN git clone https://github.com/MikePopoloski/slang.git /tmp/slang && \
    cd /tmp/slang && \
    cmake -B build -DCMAKE_BUILD_TYPE=Release && \
    cmake --build build -j$(nproc) && \
    cmake --install build && \
    rm -rf /tmp/slang

# Build Verilator v5+ (for OOP, SVA, Coverage, and C++ Execution)
# Note: Because libz3-dev is installed, Verilator natively links to Z3 for .randomize()
RUN git clone https://github.com/verilator/verilator.git /tmp/verilator && \
    cd /tmp/verilator && \
    git checkout v5.020 && \
    autoconf && \
    ./configure && \
    make -j$(nproc) && \
    make install && \
    rm -rf /tmp/verilator

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json ./
RUN npm install

# Bundle app source
COPY server.js ./

# Expose the port the app runs on
EXPOSE 3000

# Command to run the application
CMD [ "npm", "start" ]
