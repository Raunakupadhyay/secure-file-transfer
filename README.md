# 🔐 Secure File Transfer – Java Application

A secure and user-friendly file transfer system built using **Java** with a graphical user interface (GUI), implementing **AES-GCM encryption**, **password-based authentication**, and **integrity verification**. Designed for secure file sharing within a local network.

---

## 🚀 Features

- 📁 **Send & Receive Files** over LAN  
- 🔐 **AES-GCM Encryption** for strong data security  
- 🔑 **Password-Based Key Derivation (PBKDF2)**  
- 📊 **Transfer Progress & Speed Estimation**  
- 🧾 **HMAC Validation** for file integrity  
- 🌗 **Dark/Light Theme Toggle**  
- 🌐 **Auto-Discovery of Receivers on Same Network**  
- 🧠 Easy-to-use GUI with real-time status updates  

---

## 🖥️ Tech Stack

- **Language:** Java (JDK 8 or higher)  
- **GUI:** Swing  
- **Crypto:** AES-GCM, PBKDF2WithHmacSHA256, HMAC  
- **Socket Programming:** TCP  
- **Tools:** VS Code, IntelliJ IDEA, Git, GitHub  

---

## 📦 How to Run

1. Clone the repository:
    ```bash
    git clone https://github.com/yourusername/secure-file-transfer.git
    cd secure-file-transfer
    ```

2. Compile the project:
    ```bash
    javac -d out src/*.java
    ```

3. Run the app:
    ```bash
    java -cp out MainClassName
    ```

*(Replace `MainClassName` with your actual main class)*

---

## 🛡️ Security Highlights

- 256-bit AES in GCM mode ensures confidentiality + integrity  
- Keys derived from passwords using PBKDF2 with salt and iteration count  
- Random IV generated per session  
- HMAC-SHA256 used for file integrity verification  

----

## 📄 License

This project is open-source and available under the [MIT License](LICENSE).

---

## 👨‍💻 Author

**Raunak Upadhyay**  
B.Tech CSE | GLA University  
GitHub: [@raunak-coder](https://github.com/raunak-coder)  
LinkedIn: [Raunak Upadhyay](https://www.linkedin.com/in/raunak-upadhyay-375720287/)

