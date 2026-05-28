import mongoose from 'mongoose';

const connectDB = async (): Promise<void> => {
  try {
    const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/skyborne';

    try {
      await mongoose.connect(mongoURI, {
        serverSelectionTimeoutMS: 10000,
        connectTimeoutMS: 10000,
      });
    } catch (primaryError: any) {
      const shouldTryLocalFallback =
        mongoURI.includes('mongodb+srv://') &&
        primaryError?.code === 'ETIMEOUT' &&
        process.env.MONGO_ALLOW_LOCAL_FALLBACK !== 'false';

      if (!shouldTryLocalFallback) {
        throw primaryError;
      }

      const localMongoURI = process.env.MONGO_LOCAL_URI || 'mongodb://localhost:27017/skyborne';
      console.warn('⚠️ Atlas MongoDB timed out, falling back to local MongoDB:', localMongoURI);
      await mongoose.connect(localMongoURI, {
        serverSelectionTimeoutMS: 10000,
        connectTimeoutMS: 10000,
      });
    }
    
    console.log('✅ MongoDB Connected');
    
    mongoose.connection.on('error', (err) => {
      console.error('❌ MongoDB connection error:', err);
    });
    
    mongoose.connection.on('disconnected', () => {
      console.warn('⚠️ MongoDB disconnected');
    });
    
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error);
    process.exit(1);
  }
};

export default connectDB;
