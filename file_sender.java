

import javax.crypto.*;
import javax.crypto.spec.*;
import javax.swing.*;
import java.awt.*;
import java.io.*;
import java.net.Socket;
import java.security.spec.KeySpec;

public class ch_sender extends JFrame {
    private static final String SALT = "SomeRandomSalt";
    private String userPassword = "";

    private JTextArea logArea;
    private JProgressBar progressBar;
    private File[] selectedFiles;

    public ch_sender() {
        setTitle("Secure File Sender");
        setSize(500, 400);
        setDefaultCloseOperation(EXIT_ON_CLOSE);
        setLayout(new BorderLayout());

        JButton selectButton = new JButton("Select Files");
        JButton sendButton = new JButton("Send Files");
        JPasswordField passwordField = new JPasswordField(15);

        JPanel topPanel = new JPanel();
        topPanel.add(selectButton);
        topPanel.add(sendButton);
        topPanel.add(new JLabel("Password:"));
        topPanel.add(passwordField);

        logArea = new JTextArea();
        logArea.setEditable(false);
        progressBar = new JProgressBar(0, 100);
        progressBar.setStringPainted(true);

        add(topPanel, BorderLayout.NORTH);
        add(new JScrollPane(logArea), BorderLayout.CENTER);
        add(progressBar, BorderLayout.SOUTH);

        selectButton.addActionListener(e -> chooseFiles());
        passwordField.addActionListener(e -> userPassword = new String(passwordField.getPassword()));
        sendButton.addActionListener(e -> {
            userPassword = new String(passwordField.getPassword());
            sendFiles();
        });

        setVisible(true);
    }

    private void chooseFiles() {
        JFileChooser chooser = new JFileChooser();
        chooser.setMultiSelectionEnabled(true);
        if (chooser.showOpenDialog(this) == JFileChooser.APPROVE_OPTION) {
            selectedFiles = chooser.getSelectedFiles();
            log("Selected " + selectedFiles.length + " file(s).\n");
        }
    }

    private void sendFiles() {
        if (selectedFiles == null || selectedFiles.length == 0) {
            log("No files selected.\n");
            return;
        }

        String ip = JOptionPane.showInputDialog(this, "Enter Receiver IP:", "127.0.0.1");
        if (ip == null || ip.isEmpty()) {
            log("IP address is required.\n");
            return;
        }

        new Thread(() -> {
            for (File file : selectedFiles) {
                try {
                    sendFileEncrypted(file, ip);
                } catch (Exception ex) {
                    log("Error sending " + file.getName() + ": " + ex.getMessage() + "\n");
                }
            }
        }).start();
    }

    private void sendFileEncrypted(File file, String ip) throws Exception {
        try (Socket socket = new Socket(ip, 5001);
             DataOutputStream dos = new DataOutputStream(socket.getOutputStream());
             FileInputStream fis = new FileInputStream(file)) {

            dos.writeUTF(file.getName());
            dos.writeLong(file.length());

            SecretKey key = getSecretKey(userPassword, SALT);
            Cipher cipher = Cipher.getInstance("AES/ECB/PKCS5Padding");
            cipher.init(Cipher.ENCRYPT_MODE, key);
            CipherOutputStream cos = new CipherOutputStream(dos, cipher);

            byte[] buffer = new byte[2048];
            int bytesRead;
            long totalRead = 0;
            long fileSize = file.length();

            while ((bytesRead = fis.read(buffer)) != -1) {
                cos.write(buffer, 0, bytesRead);
                totalRead += bytesRead;
                int percent = (int)((totalRead * 100) / fileSize);
                progressBar.setValue(percent);
            }

            cos.flush();
            cos.close();
            log("Sent: " + file.getName() + "\n");
        }
    }

    private SecretKey getSecretKey(String password, String salt) throws Exception {
        SecretKeyFactory factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
        KeySpec spec = new PBEKeySpec(password.toCharArray(), salt.getBytes(), 65536, 128);
        SecretKey tmp = factory.generateSecret(spec);
        return new SecretKeySpec(tmp.getEncoded(), "AES/ECB/PKCS5Padding");
    }

    private void log(String message) {
        SwingUtilities.invokeLater(() -> logArea.append(message));
    }

    public static void main(String[] args) {
        SwingUtilities.invokeLater(ch_sender::new);
    }
}