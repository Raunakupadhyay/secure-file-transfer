// FileReceiverGUI.java
import javax.crypto.*;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;
import javax.swing.*;
import java.awt.*;
import java.io.*;
import java.net.ServerSocket;
import java.net.Socket;
import java.security.*;
import java.security.spec.KeySpec;
import java.util.Arrays;

public class FileReceiverGUI {
    public static void main(String[] args) {
        SwingUtilities.invokeLater(() -> {
            JFrame frame = new JFrame("File Receiver");
            frame.setSize(500, 300);
            frame.setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);
            frame.setLocationRelativeTo(null);

            JPanel panel = new JPanel(new GridBagLayout());
            panel.setBackground(Color.WHITE);
            GridBagConstraints gbc = new GridBagConstraints();
            gbc.insets = new Insets(10, 10, 10, 10);
            gbc.fill = GridBagConstraints.HORIZONTAL;

            JLabel titleLabel = new JLabel("Waiting for File...");
            titleLabel.setFont(new Font("Segoe UI", Font.BOLD, 20));
            titleLabel.setForeground(new Color(76, 175, 80));
            gbc.gridx = 0; gbc.gridy = 0; gbc.gridwidth = 2;
            panel.add(titleLabel, gbc);

            JButton saveAsButton = new JButton("Choose Save Location");
            styleButton(saveAsButton);
            gbc.gridy = 1;
            panel.add(saveAsButton, gbc);

            JProgressBar progressBar = new JProgressBar();
            progressBar.setVisible(false);
            gbc.gridy = 2;
            panel.add(progressBar, gbc);

            JLabel statusLabel = new JLabel("Status: Waiting for connection...");
            statusLabel.setFont(new Font("Segoe UI", Font.PLAIN, 13));
            gbc.gridy = 3;
            panel.add(statusLabel, gbc);

            File[] saveToFile = new File[1];

            saveAsButton.addActionListener(e -> {
                JFileChooser chooser = new JFileChooser();
                chooser.setDialogTitle("Save As");
                if (chooser.showSaveDialog(frame) == JFileChooser.APPROVE_OPTION) {
                    saveToFile[0] = chooser.getSelectedFile();
                    statusLabel.setText("Save to: " + saveToFile[0].getAbsolutePath());
                }
            });

            new Thread(() -> {
                try (ServerSocket serverSocket = new ServerSocket(5000)) {
                    while (true) {
                        Socket socket = serverSocket.accept();
                        statusLabel.setText("Client connected.");

                        if (saveToFile[0] == null) {
                            JOptionPane.showMessageDialog(frame, "Please select a save location before receiving.");
                            socket.close();
                            continue;
                        }

                        String password = JOptionPane.showInputDialog(frame, "Enter decryption password:");
                        if (password == null || password.isEmpty()) {
                            statusLabel.setText("Error: Password required");
                            socket.close();
                            continue;
                        }

                        InputStream in = socket.getInputStream();

                        byte[] salt = in.readNBytes(16);
                        byte[] iv = in.readNBytes(16);

                        SecretKey key = getKeyFromPassword(password, salt);
                        IvParameterSpec ivSpec = new IvParameterSpec(iv);

                        Cipher cipher = Cipher.getInstance("AES/CBC/PKCS5Padding");
                        cipher.init(Cipher.DECRYPT_MODE, key, ivSpec);

                        byte[] authBuffer = in.readNBytes(128);
                        byte[] decryptedAuth = cipher.doFinal(authBuffer);
                        String authMessage = new String(decryptedAuth);

                        if (!"AUTH_OK".equals(authMessage)) {
                            JOptionPane.showMessageDialog(frame, "Authentication failed! Wrong password.");
                            statusLabel.setText("Error: Authentication failed.");
                            socket.close();
                            continue;
                        }

                        statusLabel.setText("Receiving file...");
                        progressBar.setVisible(true);

                        CipherInputStream cis = new CipherInputStream(in, cipher);
                        FileOutputStream fos = new FileOutputStream(saveToFile[0]);

                        byte[] buffer = new byte[4096];
                        int bytesRead;
                        long totalReceived = 0;

                        while ((bytesRead = cis.read(buffer)) != -1) {
                            fos.write(buffer, 0, bytesRead);
                            totalReceived += bytesRead;
                            progressBar.setValue((int) Math.min(100, totalReceived / 1000));
                        }

                        fos.close();
                        cis.close();
                        socket.close();

                        statusLabel.setText("File received and decrypted.");
                        progressBar.setValue(100);
                        Thread.sleep(1000);
                        progressBar.setVisible(false);
                    }
                } catch (Exception ex) {
                    ex.printStackTrace();
                    statusLabel.setText("Error: " + ex.getMessage());
                }
            }).start();

            frame.setContentPane(panel);
            frame.setVisible(true);
        });
    }

    private static void styleButton(JButton button) {
        button.setBackground(new Color(76, 175, 80));
        button.setForeground(Color.WHITE);
        button.setFocusPainted(false);
        button.setFont(new Font("Segoe UI", Font.BOLD, 14));
    }

    private static SecretKey getKeyFromPassword(String password, byte[] salt) throws Exception {
        SecretKeyFactory factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
        KeySpec spec = new PBEKeySpec(password.toCharArray(), salt, 65536, 128);
        SecretKey tmp = factory.generateSecret(spec);
        return new SecretKeySpec(tmp.getEncoded(), "AES");
    }
}
