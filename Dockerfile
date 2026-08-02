# Use Ubuntu as the base for building Verilator
FROM ubuntu:22.04

# Prevent interactive prompts during apt installations
ENV DEBIAN_FRONTEND=noninteractive

# Install dependencies required for Verilator and Node.js
RUN apt-get update && apt-get install -y \
    git perl python3 make autoconf g++ flex bison ccache \
    libgoogle-perftools-dev numactl perl-doc \
    libfl2 libfl-dev zlib1g zlib1g-dev \
    curl ca-certificates \
    && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Clone and build Verilator 5 
RUN git clone https://github.com/verilator/verilator /tmp/verilator \
    && cd /tmp/verilator \
    && git checkout v5.026 \
    && autoconf \
    && ./configure \
    && make -j2 \
    && make install \
    && rm -rf /tmp/verilator

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
