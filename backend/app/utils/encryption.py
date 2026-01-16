from cryptography.fernet import Fernet
from app.config import get_settings
import base64

settings = get_settings()


class MessageEncryption:
    """Handle message encryption/decryption."""
    
    def __init__(self):
        # Ensure key is proper length (32 bytes when base64 decoded)
        key = settings.ENCRYPTION_KEY.encode()
        # Pad or truncate to 32 bytes
        key = key[:32].ljust(32, b'0')
        # Base64 encode for Fernet
        self.key = base64.urlsafe_b64encode(key)
        self.cipher = Fernet(self.key)
    
    def encrypt(self, message: str) -> str:
        """Encrypt a message."""
        if not message:
            return message
        encrypted = self.cipher.encrypt(message.encode())
        return encrypted.decode()
    
    def decrypt(self, encrypted_message: str) -> str:
        """Decrypt a message."""
        if not encrypted_message:
            return encrypted_message
        try:
            decrypted = self.cipher.decrypt(encrypted_message.encode())
            return decrypted.decode()
        except Exception:
            # Return as-is if decryption fails
            return encrypted_message


# Singleton instance
message_encryption = MessageEncryption()