import sys
import os
import logging
from pathlib import Path
from datetime import datetime, timedelta

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.config import get_settings
from app.models.message import Message
from app.utils.encryption import message_encryption

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("cleanup_files")

def cleanup_files():
    settings = get_settings()
    
    # Setup DB connection
    engine = create_engine(settings.DATABASE_URL)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = SessionLocal()
    
    try:
        # Retention policy: 10 days since creation
        retention_period = timedelta(days=10)
        cutoff_date = datetime.utcnow() - retention_period
        
        logger.info(f"Checking for files created before {cutoff_date}")
        
        # Find expired messages with files
        expired_messages = db.query(Message).filter(
            Message.file_path.isnot(None),
            Message.is_deleted == False, # or 0
            Message.created_at < cutoff_date
        ).all()
        
        logger.info(f"Found {len(expired_messages)} expired files to delete")
        
        for message in expired_messages:
            file_path = message.file_path
            
            # Delete file from disk
            try:
                if os.path.exists(file_path):
                    os.remove(file_path)
                    logger.info(f"Deleted file: {file_path}")
                else:
                    logger.warning(f"File not found on disk: {file_path}")
            except Exception as e:
                logger.error(f"Error deleting file {file_path}: {e}")
                # Continue with db update anyway? potentially
            
            try:
                # Update message
                message.content = "[File expired]"
                message.file_path = None
                message.file_type = None
                db.add(message)
                logger.info(f"Updated message {message.id} to remove file reference")
            except Exception as e:
                logger.error(f"Error updating message {message.id}: {e}")
        
        db.commit()
    except Exception as e:
                placeholder_text = "picture has been deleted due to data retention policy"
                # If it was a document, maybe say "document has been deleted..."? 
                # Requirement says "picture needs to be shown", "picture has been deleted..."
                # I'll stick to the required text or generic if type is document.
                
                if message.file_type == 'document':
                     placeholder_text = "document has been deleted due to data retention policy"
                
                encrypted_text = message_encryption.encrypt(placeholder_text)
                
                message.file_path = None
                message.is_deleted = True
                message.content = encrypted_text
                
                db.add(message)
                
            except Exception as e:
                logger.error(f"Error updating message {message.id}: {e}")
        
        db.commit()
        logger.info("Cleanup complete")
        
    except Exception as e:
        logger.error(f"Cleanup failed: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    cleanup_files()
