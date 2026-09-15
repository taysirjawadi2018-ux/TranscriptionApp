import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, TextInput, Alert, Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Clipboard from 'expo-clipboard';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

const SERVER_URL = 'https://8736-41-62-86-194.ngrok-free.app';

// Helper function for debugging
const logRequestError = (endpoint, error, responseStatus, responseText) => {
  console.error(`Error with ${endpoint} API:`, error);
  console.error(`Status: ${responseStatus}`);
  console.error(`Response: ${responseText || 'No response text'}`);
};

const guessMimeType = (filename) => {
  const ext = filename.split('.').pop().toLowerCase();
  switch (ext) {
    case 'mp3': return 'audio/mpeg';
    case 'wav': return 'audio/wav';
    case 'm4a': return 'audio/x-m4a';
    case 'aac': return 'audio/aac';
    case 'flac': return 'audio/flac';
    default: return 'audio/mpeg';
  }
};

export default function DashboardScreen() {
  const [files, setFiles] = useState([]);
  const [transcriptions, setTranscriptions] = useState([]);
  const [combinedText, setCombinedText] = useState('');
  const [customPrompt, setCustomPrompt] = useState('');
  const [summary, setSummary] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [copiedSummary, setCopiedSummary] = useState(false);
  const [showCombinedText, setShowCombinedText] = useState(false);
  const [quiz, setQuiz] = useState('');
  const [isGeneratingQuiz, setIsGeneratingQuiz] = useState(false);
  const [summaryVisible, setSummaryVisible] = useState(false);
  const [quizVisible, setQuizVisible] = useState(false);
  const [copiedQuiz, setCopiedQuiz] = useState(false);
  const scrollViewRef = useRef(null);

  useEffect(() => {
    if (transcriptions.length > 0) {
      const validTranscriptions = transcriptions.filter(
        item => item.text && !item.text.startsWith('Error:')
      );
      if (validTranscriptions.length > 0) {
        const newCombinedText = validTranscriptions
          .map(item => item.text.trim())
          .join(' \n\n');
        setCombinedText(newCombinedText);
      } else {
        setCombinedText('');
      }
    } else {
      setCombinedText('');
    }
  }, [transcriptions]);
  const handleFileUpload = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*', multiple: true });
    if (!result.canceled) {
      const newFiles = result.assets.map(file => ({
        uri: file.uri,
        name: file.name,
        type: file.mimeType || guessMimeType(file.name),
      }));
      setFiles(newFiles);
      setTranscriptions([]);
      setCombinedText('');
      setSummary('');
      setQuiz('');
      setCopiedSummary(false);
      setShowCombinedText(false);
      setSummaryVisible(false);
      setQuizVisible(false);
    }
  };
  const handleTranscribe = async () => {
    if (files.length === 0) return;

    setIsLoading(true);
    const results = [];

    for (const file of files) {
      try {
        const formData = new FormData();
        
        // Handle platform differences in FormData
        if (Platform.OS === 'web') {
          // For web, we need to fetch the actual file from the URI
          try {
            const response = await fetch(file.uri);
            const blob = await response.blob();
            // Create a File object from the blob
            const fileObj = new File([blob], file.name, { type: file.type || 'audio/mpeg' });
            formData.append('file', fileObj);
          } catch (fetchError) {
            console.error("Error fetching file from URI:", fetchError);
            results.push({ fileName: file.name, text: `Error: Could not process file` });
            continue;
          }
        } else {
          // For mobile (React Native)
          formData.append('file', {
            uri: file.uri,
            name: file.name,
            type: file.type || 'audio/mpeg',
          });
        }

        const response = await fetch(`${SERVER_URL}/transcribe`, {
          method: 'POST',
          body: formData,
        });

        const data = await response.json();
        results.push({ fileName: file.name, text: data.text });
      } catch (error) {
        console.error("Transcription error:", error);
        results.push({ fileName: file.name, text: `Error: ${error.message}` });
      }
    }

    setTranscriptions(results);
    setIsLoading(false);
    scrollToResults();
  };  const handleSummarize = async () => {
    if (!combinedText) return;
    setIsSummarizing(true);
    setCopiedSummary(false);
    setSummaryVisible(false);

    try {
      console.log("Sending summarize request with text length:", combinedText.length);
      
      const response = await fetch(`${SERVER_URL}/summarize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: combinedText,
          prompt: customPrompt,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'No response text');
        logRequestError('summarize', 'HTTP error', response.status, errorText);
        
        if (response.status === 422) {
          setSummary(`⚠️ Error: The server couldn't process the text. It might be too long or contain invalid characters.`);
        } else {
          setSummary(`⚠️ Error: Server returned status ${response.status}`);
        }
        return;
      }

      const data = await response.json();
      setSummary(data.summary || `⚠️ Error: ${data.error || 'No summary received.'}`);
    } catch (error) {
      console.error("Summarization error:", error);
      setSummary('⚠️ Error during summarization. Check console for details.');
    }
    setIsSummarizing(false);
    setTimeout(() => {
      setSummaryVisible(true);
      scrollToSummary();
    }, 100);
  };

  const handleCopySummary = async () => {
    if (summary && !summary.startsWith('⚠️ Error:')) {
      await Clipboard.setStringAsync(summary);
      setCopiedSummary(true);
      setTimeout(() => setCopiedSummary(false), 2000);
    } else {
      Alert.alert("Nothing to Copy", "There is no valid summary to copy.");
    }
  };

  const handleDownloadSummary = async () => {
    if (summary && !summary.startsWith('⚠️ Error:')) {
      const htmlContent = `
        <html>
          <head>
            <style>
              body {
                font-family: Arial, sans-serif;
                margin: 40px;
                font-size: 16px;
                line-height: 1.6;
                color: #333;
              }
              h1 {
                color: #8B0000;
                text-align: center;
                border-bottom: 2px solid #8B0000;
                padding-bottom: 10px;
              }
              p {
                text-align: justify;
              }
            </style>
          </head>
          <body>
            <h1>Summary</h1>
            <p>${summary.replace(/\n/g, '<br>')}</p>
          </body>
        </html>
      `;
      try {        const { uri } =        await Print.printToFileAsync({ html: htmlContent });
        if (Platform.OS === "ios") {
          await Sharing.shareAsync(uri, { UTI: '.pdf', mimeType: 'application/pdf' });
        } else {
          await Sharing.shareAsync(uri, { dialogTitle: 'Download Summary PDF', mimeType: 'application/pdf' });
        }
      } catch (error) {
        Alert.alert("Download Error", "Could not generate or share the PDF.");
        console.error("Error downloading summary: ", error);
      }
    } else {
      Alert.alert("Nothing to Download", "There is no valid summary to download.");
    }
  };
    const handleGenerateQuiz = async () => {
    if (!combinedText) return;
    setIsGeneratingQuiz(true);
    setQuizVisible(false);
    setCopiedQuiz(false);
    
    try {
      console.log("Sending quiz generation request with text length:", combinedText.length);

      // Check if text might be too large
      if (combinedText.length > 100000) {
        console.warn("Text is very large, might cause issues with API:", combinedText.length);
      }
      
      const response = await fetch(`${SERVER_URL}/generate-quiz`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: combinedText,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'No response text');
        logRequestError('generate-quiz', 'HTTP error', response.status, errorText);
        
        if (response.status === 422) {
          setQuiz(`⚠️ Error: The server couldn't process the text for the quiz. It might be too long or contain invalid characters.`);
        } else {
          setQuiz(`⚠️ Error: Server returned status ${response.status}`);
        }
        return;
      }

      const data = await response.json();
      setQuiz(data.quiz || `⚠️ Error: ${data.error || 'No quiz received.'}`);
    } catch (error) {
      console.error("Quiz generation error:", error);
      setQuiz('⚠️ Error generating quiz. Check console for details.');
    }
    setIsGeneratingQuiz(false);
    setTimeout(() => {
      setQuizVisible(true);
      scrollToQuiz();
    }, 100);
  };
  
  const handleCopyQuiz = async () => {
    if (quiz && !quiz.startsWith('⚠️ Error:')) {
      await Clipboard.setStringAsync(quiz);
      setCopiedQuiz(true);
      setTimeout(() => setCopiedQuiz(false), 2000);
    } else {
      Alert.alert("Nothing to Copy", "There is no valid quiz to copy.");
    }
  };

  const handleDownloadQuiz = async () => {
    if (quiz && !quiz.startsWith('⚠️ Error:')) {
      const htmlContent = `
        <html>
          <head>
            <style>
              body {
                font-family: Arial, sans-serif;
                margin: 40px;
                font-size: 16px;
                line-height: 1.6;
                color: #333;
              }
              h1 {
                color: #8B0000;
                text-align: center;
                border-bottom: 2px solid #8B0000;
                padding-bottom: 10px;
              }
              .question {
                margin-bottom: 30px;
              }
              .options {
                margin-left: 20px;
              }
              .answer {
                font-weight: bold;
                margin-top: 10px;
                color: #8B0000;
              }
            </style>
          </head>
          <body>
            <h1>Knowledge Check Quiz</h1>
            ${quiz.replace(/\n/g, '<br>').replace(/Question (\d+):/g, '<div class="question"><strong>Question $1:</strong>').replace(/Answer:/g, '<p class="answer">Answer:').replace(/Answer: ([A-D])/g, 'Answer: $1</p></div>')}
          </body>
        </html>
      `;
      try {
        const { uri } = await Print.printToFileAsync({ html: htmlContent });
        if (Platform.OS === "ios") {
          await Sharing.shareAsync(uri, { UTI: '.pdf', mimeType: 'application/pdf' });
        } else {
          await Sharing.shareAsync(uri, { dialogTitle: 'Download Quiz PDF', mimeType: 'application/pdf' });
        }
      } catch (error) {
        Alert.alert("Download Error", "Could not generate or share the PDF.");
        console.error("Error downloading quiz: ", error);
      }
    } else {
      Alert.alert("Nothing to Download", "There is no valid quiz to download.");
    }
  };
  const toggleCombinedTextView = () => {
    setShowCombinedText(!showCombinedText);
  };
  
  const scrollToResults = () => {
    setTimeout(() => {
      scrollViewRef.current?.scrollTo({ y: 500, animated: true });
    }, 300);
  };

  const scrollToSummary = () => {
    setTimeout(() => {
      scrollViewRef.current?.scrollTo({ y: 0, animated: true });
    }, 100);
  };

  const scrollToQuiz = () => {
    setTimeout(() => {
      scrollViewRef.current?.scrollTo({ y: 0, animated: true });
    }, 100);
  };
  return (
    <ScrollView 
      ref={scrollViewRef}
      contentContainerStyle={styles.container} 
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <Image source={require('../assets/OratO.png')} style={styles.logo} />
      <Text style={styles.title}>Welcome to OratO</Text>
      <Text style={styles.subtitle}>Your AI-Powered Transcription Assistant</Text>
      
      {/* Summary section - shown at the top when available */}
      {summary !== '' && !isSummarizing && (
        <View 
          style={[
            styles.transcriptionCard, 
            styles.summaryCard,
            summaryVisible && styles.popupAnimation,
            { marginTop: 20, marginBottom: 60 }
          ]}
        >
          <View style={styles.cardHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
              <MaterialIcons name="description" size={20} color="#FFB6C1" />              <Text style={[styles.fileName, styles.summaryTitle]}>Summary</Text>
            </View>
            <TouchableOpacity onPress={handleCopySummary} style={styles.iconButton}>
              <Ionicons name={copiedSummary ? "checkmark-circle" : "copy-outline"} size={24} color={copiedSummary ? "#4CAF50" : "#FFB6C1"} />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleDownloadSummary} style={styles.iconButton}>
              <Ionicons name="download-outline" size={24} color="#FFB6C1" />
            </TouchableOpacity>
          </View>
          {copiedSummary && <Text style={styles.copiedFeedback}>Summary copied!</Text>}
          <ScrollView 
            style={styles.summaryScrollView}
            nestedScrollEnabled={true}
            showsVerticalScrollIndicator={true}
            persistentScrollbar={true}
          >
            <Text style={styles.summaryText}>{summary}</Text>
          </ScrollView>
        </View>
      )}
      
      {/* Quiz section - shown at the top when available */}
      {quiz !== '' && !isGeneratingQuiz && (
        <View 
          style={[
            styles.transcriptionCard, 
            styles.quizCard,
            quizVisible && styles.popupAnimation,
            { marginTop: 20, marginBottom: 60 }
          ]}
        >
          <View style={styles.cardHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
              <MaterialIcons name="quiz" size={20} color="#FFB6C1" />              <Text style={[styles.fileName, styles.quizTitle]}>Knowledge Check Quiz</Text>
            </View>
            <TouchableOpacity onPress={handleCopyQuiz} style={styles.iconButton}>
              <Ionicons name={copiedQuiz ? "checkmark-circle" : "copy-outline"} size={24} color={copiedQuiz ? "#4CAF50" : "#FFB6C1"} />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleDownloadQuiz} style={styles.iconButton}>
              <Ionicons name="download-outline" size={24} color="#FFB6C1" />
            </TouchableOpacity>
          </View>
          {copiedQuiz && <Text style={styles.copiedFeedback}>Quiz copied!</Text>}
          <ScrollView 
            style={styles.quizScrollView}
            nestedScrollEnabled={true}
            showsVerticalScrollIndicator={true}
            persistentScrollbar={true}
          >
            <Text style={styles.quizText}>{quiz}</Text>
          </ScrollView>
        </View>
      )}

      {/* Loading indicators for summary and quiz */}
      {isSummarizing && (
        <View style={[styles.loadingContainer, { marginTop: 20, marginBottom: 60 }]}>
          <ActivityIndicator size="large" color="#FFFFFF" />
          <Text style={styles.loadingText}>Generating your summary...</Text>
        </View>
      )}
      
      {isGeneratingQuiz && (
        <View style={[styles.loadingContainer, { marginTop: 20, marginBottom: 60 }]}>
          <ActivityIndicator size="large" color="#FFFFFF" />
          <Text style={styles.loadingText}>Creating quiz questions...</Text>
        </View>
      )}

      {/* Visual separator after quiz/summary when present */}
      {(summary !== '' || quiz !== '') && !isGeneratingQuiz && !isSummarizing && (
        <View style={styles.contentSeparator} />
      )}

      <View style={styles.cardContainer}>
        <LinearGradient
          colors={['#8B0000', '#A52A2A']}
          style={styles.gradientCard}
        >
          <TouchableOpacity 
            style={styles.uploadButton} 
            onPress={handleFileUpload}
            activeOpacity={0.8}
          >
            <Ionicons name="cloud-upload-outline" size={32} color="white" />
            <Text style={styles.buttonText}>Upload Audio Files</Text>
            {files.length > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{files.length}</Text>
              </View>
            )}
          </TouchableOpacity>
        </LinearGradient>

        {files.length === 0 && !isLoading && (
          <View style={styles.emptyStateContainer}>
            <Ionicons name="document-text-outline" size={60} color="#A52A2A" />
            <Text style={styles.emptyStateText}>Upload audio files to begin.</Text>
            <Text style={styles.emptyStateSubText}>Tap the "Upload Audio Files" button above.</Text>
          </View>
        )}
        
        {files.length > 0 && (
          <>
            <View style={styles.actionButtons}>
              <LinearGradient
                colors={['#DC143C', '#B22222']}
                style={[styles.gradientButton, isLoading && styles.disabledButton]}
              >
                <TouchableOpacity
                  style={styles.button}
                  onPress={handleTranscribe}
                  disabled={isLoading}
                >
                  <MaterialIcons name="graphic-eq" size={20} color="white" />
                  <Text style={styles.buttonText} numberOfLines={1}>
                    {isLoading ? 'Transcribing...' : 'Transcribe'}
                  </Text>
                </TouchableOpacity>
              </LinearGradient>

              {transcriptions.length > 0 && (
                <LinearGradient
                  colors={['#CD5C5C', '#C71585']}
                  style={[styles.gradientButton, (!combinedText || isSummarizing) && styles.disabledButton]}
                >
                  <TouchableOpacity
                    style={styles.button}
                    onPress={handleSummarize}
                    disabled={!combinedText || isSummarizing}
                  >
                    <MaterialIcons name="summarize" size={20} color="white" />
                    <Text style={styles.buttonText} numberOfLines={1}>
                      {isSummarizing ? 'Summarizing...' : 'Summary'}
                    </Text>
                  </TouchableOpacity>
                </LinearGradient>
              )}
              
              {transcriptions.length > 0 && (
                <LinearGradient
                  colors={['#B22222', '#8B0000']}
                  style={[styles.gradientButton, (!combinedText || isGeneratingQuiz) && styles.disabledButton]}
                >
                  <TouchableOpacity
                    style={styles.button}
                    onPress={handleGenerateQuiz}
                    disabled={!combinedText || isGeneratingQuiz}
                  >
                    <MaterialIcons name="quiz" size={20} color="white" />
                    <Text style={styles.buttonText} numberOfLines={1}>
                      {isGeneratingQuiz ? 'Creating...' : 'Quiz'}
                    </Text>
                  </TouchableOpacity>
                </LinearGradient>
              )}
            </View>
            
            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Custom Instructions (Optional)</Text>
              <TextInput
                placeholder="Add specific instructions for the summary..."
                placeholderTextColor="#D3D3D3"
                style={styles.input}
                value={customPrompt}
                onChangeText={setCustomPrompt}
                multiline
              />
            </View>
          </>
        )}

        {transcriptions.length > 0 && !isLoading && (
          <TouchableOpacity onPress={toggleCombinedTextView} style={styles.toggleButton}>
            <Ionicons name={showCombinedText ? "eye-off-outline" : "eye-outline"} size={20} color="#FFC0CB" />
            <Text style={styles.toggleButtonText}>
              {showCombinedText ? 'Hide Combined Text' : 'View Combined Text'}
            </Text>
          </TouchableOpacity>
        )}
        
        {showCombinedText && combinedText && !isLoading && (
          <View style={[styles.transcriptionCard, styles.combinedTextCard]}>
            <View style={styles.cardHeader}>
                <MaterialIcons name="merge-type" size={20} color="#FFC0CB" />
                <Text style={[styles.fileName, {color: '#FFC0CB'}]}>Combined Transcription</Text>
            </View>
            <ScrollView 
              style={styles.combinedTextScrollView} 
              nestedScrollEnabled={true}
              showsVerticalScrollIndicator={true}
              persistentScrollbar={true}
            > 
                <Text style={styles.transcriptionText}>{combinedText}</Text>
            </ScrollView>
          </View>
        )}

        {isLoading && files.length > 0 && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#FFFFFF" />
            <Text style={styles.loadingText}>Processing your audio files...</Text>
          </View>
        )}
        
        {transcriptions.length > 0 && !isLoading && (
          <View style={styles.resultsSection}>
            <Text style={styles.sectionTitle}>Transcription Results</Text>
            {transcriptions.map((item, index) => (
              <View key={index} style={styles.transcriptionCard}>
                <View style={styles.cardHeader}>
                  <MaterialIcons name="audiotrack" size={20} color="#FFC0CB" />
                  <Text style={styles.fileName}>{item.fileName}</Text>
                </View>
                <Text style={styles.transcriptionText}>{item.text}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: '#3D0000',
    alignItems: 'center',
    padding: 20,
    paddingBottom: 40,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  subtitle: {
    color: '#F5F5F5',
    fontSize: 16,
    marginBottom: 20,
  },
  cardContainer: {
    width: '100%',
  },
  gradientCard: {
    borderRadius: 14,
    marginBottom: 20,
    padding: 20,
  },
  uploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  badge: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },  badgeText: {
    color: '#8B0000',
    fontWeight: 'bold',
  },
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
    marginTop: 10,
    width: '100%',
  },
  gradientButton: {
    flex: 1,
    borderRadius: 24,
    marginHorizontal: 5,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 14,
    marginLeft: 5,
    fontWeight: '500',
    textAlign: 'center',
    flexShrink: 1,
  },
  disabledButton: {
    opacity: 0.6,
  },
  loadingContainer: {
    alignItems: 'center',
    marginVertical: 20,
  },
  loadingText: {
    color: '#F5F5F5',
    marginTop: 10,
    fontSize: 14,
  },
  resultsSection: {
    width: '100%',
    marginTop: 24,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#FFFFFF',
    marginVertical: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#7A0000',
    textAlign: 'center',
  },
  transcriptionCard: {
    backgroundColor: '#5C0000',
    borderRadius: 16,
    padding: 15,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#7A0000',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    justifyContent: 'space-between',
  },
  fileName: {
    color: '#FFC0CB',
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 8,
    flexShrink: 1,
  },
  transcriptionText: {
    color: '#F5F5F5',
    fontSize: 15,
    lineHeight: 22,
  },
  inputContainer: {
    marginTop: 20,
    marginBottom: 10,
    paddingHorizontal: 5,
  },
  inputLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: '#F5F5F5',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#4A0000',
    color: '#FFFFFF',
    borderRadius: 10,
    paddingHorizontal: 15,
    paddingVertical: 12,
    width: '100%',
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#7A0000',
    minHeight: 60,
  },
  summaryCard: {
    borderLeftWidth: 4,
    borderLeftColor: '#FF6347',
    backgroundColor: '#500000',
  },
  summaryTitle: {
    color: '#FFB6C1',
  },
  summaryText: {
    fontSize: 16,
    color: '#F5F5F5',
    lineHeight: 24,
    fontStyle: 'italic',
    marginBottom: 10,
  },
  summaryScrollView: {
    maxHeight: 300,
    flexGrow: 0,
    backgroundColor: 'transparent', // Use transparent to show parent card color
    padding: 4,
    marginBottom: 10,
  },
  quizCard: {
    borderLeftWidth: 4,
    borderLeftColor: '#B22222',
    backgroundColor: '#4A0000',
    paddingBottom: 20,
  },
  quizTitle: {
    color: '#FFB6C1',
  },
  quizText: {
    fontSize: 16,
    color: '#F5F5F5',
    lineHeight: 26,
    whiteSpace: 'pre-wrap',
    paddingHorizontal: 5,
    paddingTop: 10,
  },
  quizScrollView: {
    maxHeight: 300,
    flexGrow: 0,
    backgroundColor: 'transparent', // Use transparent to show parent card color
    padding: 4,
    marginBottom: 10,
  },
  emptyStateContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    paddingHorizontal: 20,
    backgroundColor: '#5C0000',
    borderRadius: 16,
    marginVertical: 20,
    borderWidth: 1,
    borderColor: '#7A0000',
  },
  emptyStateText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
    marginTop: 15,
    textAlign: 'center',
  },
  emptyStateSubText: {
    fontSize: 14,
    color: '#F5F5F5',
    marginTop: 8,
    textAlign: 'center',
  },
  iconButton: {
    padding: 8,
    marginLeft: 8,
  },
  copiedFeedback: {
    color: '#4CAF50',
    fontSize: 12,
    textAlign: 'right',
    marginBottom: 5,
    fontStyle: 'italic',
  },
  logo: {
    width: 250,
    height: 140,
    resizeMode: 'contain',
    marginTop: 40,
    marginBottom: 10,
  },
  toggleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#5C0000',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 24,
    marginVertical: 15,
    borderWidth: 1,
    borderColor: '#7A0000',
    alignSelf: 'center',
  },
  toggleButtonText: {
    color: '#FFC0CB',    fontSize: 16,
    marginLeft: 10,
    fontWeight: '500',
  },
  combinedTextCard: {
    marginTop: 10,
    borderColor: '#CD5C5C',
  },
  combinedTextScrollView: {
    maxHeight: 200,
    flexGrow: 0,
    backgroundColor: 'transparent', // Use transparent to show parent card color
    padding: 4,
  },
  contentSeparator: {
    borderBottomWidth: 3,
    borderBottomColor: '#8B0000',
    width: '80%',
    alignSelf: 'center',
    marginBottom: 30,
    marginTop: 10,
    shadowColor: '#FFB6C1',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  popupAnimation: {
    shadowColor: '#FFB6C1',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 20,
    elevation: 10,
    borderWidth: 2,
    borderColor: '#FF1493',
    transform: [{ scale: 1.05 }],
    backgroundColor: '#8B0000',
    animation: 'fadeIn 0.5s',
  },
});
