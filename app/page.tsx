"use client";
import React, { useState, useEffect, useCallback } from 'react';
import Papa from 'papaparse';
import Plot from 'react-plotly.js';
import jsPDF from 'jspdf';
import './globals.css';
import html2canvas from 'html2canvas';
import { 
  Upload, 
  FileText, 
  CheckCircle, 
  AlertTriangle, 
  Download, 
  BarChart3, 
  PieChart, 
  TrendingUp,
  FileDown,
  Search,
  Shuffle,
  Target,
  Sparkles,
  Eye,
  Settings
} from 'lucide-react';
import _ from 'lodash';

// Types
interface CSVData {
  data: any[][];
  headers: string[];
  meta: {
    delimiter: string;
    linebreak: string;
    aborted: boolean;
    truncated: boolean;
    cursor: number;
  };
}

interface Issues {
  missing: Record<string, number>;
  duplicates: number;
  whitespace: Record<string, string>;
  leadingZeros: Record<string, string>;
  outliers: Record<string, number>;
  dataTypes: Record<string, string>;
  structure: {
    columns: number;
    rowCount: number;
    ragged?: boolean;
    emptyRows?: number;
  };
}

interface CleaningLog {
  message: string;
  type: 'success' | 'info' | 'warning' | 'error';
}

const AutoCleanCSV: React.FC = () => {
  // State management
  const [csvData, setCsvData] = useState<any[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [issues, setIssues] = useState<Issues | null>(null);
  const [cleanedData, setCleanedData] = useState<any[]>([]);
  const [cleaningLog, setCleaningLog] = useState<CleaningLog[]>([]);
  const [currentPage, setCurrentPage] = useState<'audit' | 'clean' | 'analysis' | 'report'>('audit');
  const [isLoading, setIsLoading] = useState(false);
  const [charts, setCharts] = useState<any[]>([]);
  const [selectedRow, setSelectedRow] = useState<any>(null);
  const [selectedColumn, setSelectedColumn] = useState<string>('');

  // File upload handler
  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
  
    setIsLoading(true);
  
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        try {
          const results = Papa.parse(reader.result, {
            header: false,
            skipEmptyLines: true,
          });
    
          const [headerRow, ...dataRows] = results.data as any[];
          setHeaders(headerRow);
          setCsvData(dataRows);
          detectIssues(dataRows, headerRow);
          setIsLoading(false);
        } catch (error) {
          console.error('Error parsing CSV:', error);
          setIsLoading(false);
        }
      } else {
        console.error('FileReader result is not a string');
        setIsLoading(false);
      }
    };
    
    reader.onerror = () => {
      console.error('Error reading file');
      setIsLoading(false);
    };
  
    reader.readAsText(file);
  }, []);
  

  // Issue detection
  const detectIssues = useCallback((data: any[][], headers: string[]) => {
    const detectedIssues: Issues = {
      missing: {},
      duplicates: 0,
      whitespace: {},
      leadingZeros: {},
      outliers: {},
      dataTypes: {},
      structure: {
        columns: headers.length,
        rowCount: data.length
      }
    };

    // Convert to object format for easier analysis
    const objectData = data.map(row => {
      const obj: any = {};
      headers.forEach((header, index) => {
        obj[header] = row[index] || '';
      });
      return obj;
    });

    // Detect missing values
    headers.forEach(header => {
      const missingCount = objectData.filter(row => !row[header] || row[header].toString().trim() === '').length;
      if (missingCount > 0) {
        detectedIssues.missing[header] = missingCount;
      }
    });

    // Detect duplicates
    const uniqueRows = _.uniqBy(objectData, row => JSON.stringify(row));
    detectedIssues.duplicates = objectData.length - uniqueRows.length;

    // Detect whitespace issues
    headers.forEach(header => {
      const hasWhitespace = objectData.some(row => {
        const value = row[header]?.toString() || '';
        return value !== value.trim() || value.includes('\u00a0');
      });
      if (hasWhitespace) {
        detectedIssues.whitespace[header] = 'leading_or_trailing_space';
      }
    });

    // Detect leading zero issues
    headers.forEach(header => {
      const hasLeadingZeros = objectData.some(row => {
        const value = row[header]?.toString() || '';
        return /^\d+$/.test(value) && value.startsWith('0') && value.length > 1;
      });
      if (hasLeadingZeros) {
        detectedIssues.leadingZeros[header] = 'leading_zeros_lost';
      }
    });
    function quantile(arr: number[], q: number) {
      if (arr.length === 0) return 0;
      const sorted = [...arr].sort((a, b) => a - b);
      const pos = (sorted.length - 1) * q;
      const base = Math.floor(pos);
      const rest = pos - base;
    
      if (sorted[base + 1] !== undefined) {
        return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
      } else {
        return sorted[base];
      }
    }
    
    // Detect outliers in numeric columns
    headers.forEach(header => {
      const numericValues = objectData
        .map(row => parseFloat(row[header]))
        .filter(val => !isNaN(val));
      
      if (numericValues.length > 10) {
        const q1 = quantile(numericValues, 0.25);
        const q3 = quantile(numericValues, 0.75);
        const iqr = q3 - q1;
        const outliers = numericValues.filter(val => val < (q1 - 3 * iqr) || val > (q3 + 3 * iqr));
        
        if (outliers.length > 0) {
          detectedIssues.outliers[header] = outliers.length;
        }
      }
    });

    setIssues(detectedIssues);
  }, []);

  // Data cleaning function
  const cleanData = useCallback(() => {
    if (!issues || csvData.length === 0) return;

    setIsLoading(true);
    let cleaned = [...csvData];
    const log: CleaningLog[] = [];

    // Convert to object format
    let objectData = cleaned.map(row => {
      const obj: any = {};
      headers.forEach((header, index) => {
        obj[header] = row[index] || '';
      });
      return obj;
    });

    // Remove duplicates
    if (issues.duplicates > 0) {
      const beforeCount = objectData.length;
      objectData = _.uniqBy(objectData, row => JSON.stringify(row));
      log.push({
        message: `✂️ Removed ${beforeCount - objectData.length} duplicate rows`,
        type: 'success'
      });
    }

    // Fix whitespace issues
    Object.keys(issues.whitespace).forEach(column => {
      objectData = objectData.map(row => ({
        ...row,
        [column]: row[column]?.toString().replace(/\u00a0/g, ' ').trim() || ''
      }));
      log.push({
        message: `✨ Fixed whitespace in '${column}'`,
        type: 'success'
      });
    });

    // Restore leading zeros
    Object.keys(issues.leadingZeros).forEach(column => {
      const maxLength = Math.max(...objectData.map(row => row[column]?.toString().length || 0));
      objectData = objectData.map(row => ({
        ...row,
        [column]: row[column]?.toString().padStart(maxLength, '0') || ''
      }));
      log.push({
        message: `🔢 Restored leading zeros in '${column}'`,
        type: 'success'
      });
    });
    function median(values: number[]): number {
      if (values.length === 0) return 0;
    
      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
    
      if (sorted.length % 2 === 0) {
        return (sorted[mid - 1] + sorted[mid]) / 2;
      } else {
        return sorted[mid];
      }
    }
    
    // Fill missing values
    Object.keys(issues.missing).forEach(column => {
      const nonEmptyValues = objectData
        .map(row => row[column])
        .filter(val => val && val.toString().trim() !== '');
      
      if (nonEmptyValues.length > 0) {
        // Try to determine if it's numeric
        const numericValues = nonEmptyValues
          .map(val => parseFloat(val))
          .filter(val => !isNaN(val));
        
        let fillValue;
        if (numericValues.length === nonEmptyValues.length) {
          // It's numeric, use median
          fillValue = median(numericValues);
        } else {
          // It's categorical, use mode
          const counts = _.countBy(nonEmptyValues);
          fillValue = _.maxBy(Object.keys(counts), key => counts[key]) || 'Unknown';
        }

        objectData = objectData.map(row => ({
          ...row,
          [column]: (row[column] && row[column].toString().trim()) || fillValue
        }));

        log.push({
          message: `🩹 Filled ${issues.missing[column]} missing values in '${column}'`,
          type: 'success'
        });
      }
    });

    // Convert back to array format
    const cleanedArrayData = objectData.map(row => headers.map(header => row[header]));

    setCleanedData(cleanedArrayData);
    setCleaningLog(log);
    setIsLoading(false);

    log.push({
      message: '🎉 Data cleaning complete!',
      type: 'success'
    });
  }, [csvData, headers, issues]);

  // Download cleaned CSV
  const downloadCSV = useCallback(() => {
    const csvContent = [headers, ...cleanedData]
      .map((row: (string | null | undefined)[]) => 
        row.map((cell: string | null | undefined) => `"${cell ?? ''}"`).join(',')
      )
      .join('\n');
  
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', 'cleaned_data.csv');
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }, [headers, cleanedData]);
  

  // Generate PDF report
  const generatePDF = useCallback(async () => {
    const pdf = new jsPDF();
    
    // Title page
    pdf.setFontSize(20);
    pdf.text('AutoClean CSV Report', 20, 30);
    
    pdf.setFontSize(12);
    pdf.text(`Generated: ${new Date().toLocaleDateString()}`, 20, 50);
    pdf.text(`Original rows: ${csvData.length}`, 20, 70);
    pdf.text(`Cleaned rows: ${cleanedData.length}`, 20, 80);
    pdf.text(`Columns: ${headers.length}`, 20, 90);

    // Add cleaning log
    let yPos = 110;
    pdf.text('Cleaning Summary:', 20, yPos);
    yPos += 10;
    
    cleaningLog.forEach(log => {
      if (yPos > 270) {
        pdf.addPage();
        yPos = 20;
      }
      pdf.text(`• ${log.message}`, 25, yPos);
      yPos += 8;
    });

    pdf.save('autoclean-report.pdf');
  }, [csvData, cleanedData, headers, cleaningLog]);

  // Data analysis functions
  const getDataForAnalysis = useCallback(() => {
    const data = cleanedData.length > 0 ? cleanedData : csvData;
    return data.map(row => {
      const obj: any = {};
      headers.forEach((header, index) => {
        obj[header] = row[index] || '';
      });
      return obj;
    });
  }, [cleanedData, csvData, headers]);

  // Navigation component
  const Navigation = () => (
    <div className="flex space-x-1 bg-gray-100 rounded-lg p-1 mb-6">
      {[
        { id: 'audit', label: 'Data Audit', icon: FileText },
        { id: 'clean', label: 'Clean Data', icon: Settings },
        { id: 'analysis', label: 'Analysis', icon: BarChart3 },
        { id: 'report', label: 'Report', icon: FileDown }
      ].map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => setCurrentPage(id as any)}
          className={`flex items-center space-x-2 px-4 py-2 rounded-md transition-all ${
            currentPage === id
              ? 'bg-blue-500 text-white shadow-md'
              : 'text-gray-600 hover:bg-white hover:shadow-sm'
          }`}
        >
          <Icon size={18} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );

  // Metrics component
  const MetricCard = ({ label, value, icon: Icon, color = 'blue' }: {
    label: string;
    value: string | number;
    icon: React.ElementType;
    color?: string;
  }) => (
    <div className={`bg-white rounded-lg shadow-md p-6 border-l-4 border-${color}-500`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-gray-600 text-sm font-medium">{label}</p>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
        </div>
        <Icon className={`h-8 w-8 text-${color}-500`} />
      </div>
    </div>
  );

  if (csvData.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 py-12">
        <div className="max-w-4xl mx-auto px-4">
          <div className="text-center">
            <Upload className="mx-auto h-16 w-16 text-gray-400 mb-4" />
            <h1 className="text-3xl font-bold text-gray-900 mb-2">AutoClean CSV</h1>
            <p className="text-gray-600 mb-8">
              Comprehensive data cleaning and analysis tool for production use
            </p>
            
            <div className="bg-white rounded-lg shadow-lg p-8 max-w-md mx-auto">
              <h2 className="text-xl font-semibold mb-4">Upload Your CSV File</h2>
              <input
                type="file"
                accept=".csv"
                onChange={handleFileUpload}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
              />
              <p className="text-xs text-gray-500 mt-2">
                Supports CSV files up to 50MB
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold text-gray-900">AutoClean CSV</h1>
          <p className="text-gray-600">
            {csvData.length.toLocaleString()} rows × {headers.length} columns
          </p>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        <Navigation />

        {/* Loading State */}
        {isLoading && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 flex items-center space-x-4">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
              <span>Processing your data...</span>
            </div>
          </div>
        )}

        {/* Page Content */}
        {currentPage === 'audit' && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-900">📊 Data Quality Audit</h2>
            
            {/* Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <MetricCard
                label="Total Rows"
                value={csvData.length.toLocaleString()}
                icon={BarChart3}
                color="blue"
              />
              <MetricCard
                label="Columns"
                value={headers.length}
                icon={PieChart}
                color="green"
              />
              <MetricCard
                label="Missing Values"
                value={Object.keys(issues?.missing || {}).length}
                icon={AlertTriangle}
                color="yellow"
              />
              <MetricCard
                label="Duplicates"
                value={issues?.duplicates || 0}
                icon={CheckCircle}
                color="red"
              />
            </div>

            {/* Issues Details */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Missing Values */}
              <div className="bg-white rounded-lg shadow-md p-6">
                <h3 className="text-lg font-semibold mb-4 flex items-center">
                  <AlertTriangle className="mr-2 text-yellow-500" size={20} />
                  Missing Values
                </h3>
                {Object.keys(issues?.missing || {}).length > 0 ? (
                  <div className="space-y-2">
                    {Object.entries(issues?.missing || {}).map(([col, count]) => (
                      <div key={col} className="flex justify-between">
                        <span className="font-medium">{col}</span>
                        <span className="text-red-600">{count} missing</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-green-600">✅ No missing values detected</p>
                )}
              </div>

              {/* Duplicates */}
              <div className="bg-white rounded-lg shadow-md p-6">
                <h3 className="text-lg font-semibold mb-4 flex items-center">
                  <CheckCircle className="mr-2 text-red-500" size={20} />
                  Duplicate Rows
                </h3>
                {(issues?.duplicates || 0) > 0 ? (
                  <p className="text-red-600">⚠️ {issues?.duplicates} duplicate rows found</p>
                ) : (
                  <p className="text-green-600">✅ No duplicate rows</p>
                )}
              </div>

              {/* Whitespace Issues */}
              <div className="bg-white rounded-lg shadow-md p-6">
                <h3 className="text-lg font-semibold mb-4">Whitespace Issues</h3>
                {Object.keys(issues?.whitespace || {}).length > 0 ? (
                  <div className="space-y-1">
                    {Object.keys(issues?.whitespace || {}).map(col => (
                      <p key={col} className="text-yellow-600">⚠️ {col}</p>
                    ))}
                  </div>
                ) : (
                  <p className="text-green-600">✅ No whitespace issues</p>
                )}
              </div>

              {/* Leading Zeros */}
              <div className="bg-white rounded-lg shadow-md p-6">
                <h3 className="text-lg font-semibold mb-4">Leading Zero Issues</h3>
                {Object.keys(issues?.leadingZeros || {}).length > 0 ? (
                  <div className="space-y-1">
                    {Object.keys(issues?.leadingZeros || {}).map(col => (
                      <p key={col} className="text-yellow-600">🔢 {col}</p>
                    ))}
                  </div>
                ) : (
                  <p className="text-green-600">✅ No leading zero issues</p>
                )}
              </div>
            </div>

            {/* Data Preview */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <h3 className="text-lg font-semibold mb-4 flex items-center">
                <Eye className="mr-2" size={20} />
                Data Preview
              </h3>
              <div className="overflow-x-auto">
                <table className="min-w-full table-auto">
                  <thead>
                    <tr className="bg-gray-50">
                      {headers.map((header, index) => (
                        <th key={index} className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                                        {csvData.slice(0, 5).map((row: string[], rowIndex: number) => (
                        <tr key={rowIndex}>
                          {row.map((cell: string | null | undefined, cellIndex: number) => (
                            <td key={cellIndex} className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">
                              {cell?.toString() || ''}
                            </td>
                          ))}
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {currentPage === 'clean' && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-900">🧹 Data Cleaning</h2>
            
            <div className="bg-white rounded-lg shadow-md p-6">
              <h3 className="text-lg font-semibold mb-4">Issues to Fix</h3>
              
              <div className="space-y-2 mb-6">
                {Object.keys(issues?.missing || {}).length > 0 && (
                  <p>• Missing values in {Object.keys(issues?.missing || {}).length} columns</p>
                )}
                {(issues?.duplicates || 0) > 0 && (
                  <p>• {issues?.duplicates} duplicate rows</p>
                )}
                {Object.keys(issues?.whitespace || {}).length > 0 && (
                  <p>• Whitespace issues in {Object.keys(issues?.whitespace || {}).length} columns</p>
                )}
                {Object.keys(issues?.leadingZeros || {}).length > 0 && (
                  <p>• Leading zero issues in {Object.keys(issues?.leadingZeros || {}).length} columns</p>
                )}
              </div>

              <button
                onClick={cleanData}
                disabled={isLoading}
                className="bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 px-6 rounded-lg disabled:opacity-50 flex items-center space-x-2"
              >
                <Sparkles size={18} />
                <span>Clean All Issues</span>
              </button>
            </div>

            {/* Cleaning Log */}
            {cleaningLog.length > 0 && (
              <div className="bg-white rounded-lg shadow-md p-6">
                <h3 className="text-lg font-semibold mb-4">Cleaning Results</h3>
                <div className="space-y-2">
                  {cleaningLog.map((log, index) => (
                    <p key={index} className="text-sm text-gray-700">{log.message}</p>
                  ))}
                </div>
                
                <div className="mt-6 flex space-x-4">
                  <button
                    onClick={downloadCSV}
                    className="bg-green-500 hover:bg-green-600 text-white font-semibold py-2 px-4 rounded-lg flex items-center space-x-2"
                  >
                    <Download size={18} />
                    <span>Download Cleaned CSV</span>
                  </button>
                </div>
              </div>
            )}

            {/* Cleaned Data Preview */}
            {cleanedData.length > 0 && (
              <div className="bg-white rounded-lg shadow-md p-6">
                <h3 className="text-lg font-semibold mb-4">Cleaned Data Preview</h3>
                <div className="overflow-x-auto">
                  <table className="min-w-full table-auto">
                    <thead>
                      <tr className="bg-gray-50">
                        {headers.map((header, index) => (
                          <th key={index} className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                                              {cleanedData.slice(0, 10).map((row: (string | null | undefined)[], rowIndex: number) => (
                            <tr key={rowIndex}>
                              {row.map((cell: string | null | undefined, cellIndex: number) => (
                                <td key={cellIndex} className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">
                                  {cell?.toString() || ''}
                                </td>
                              ))}
                            </tr>
                          ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

{currentPage === 'analysis' && (
  <div className="space-y-8 animate-fadeIn">
    <div className="flex items-center space-x-3 mb-6">
      <div className="p-3 bg-gradient-to-r from-purple-500 to-indigo-500 rounded-xl shadow-lg">
        <BarChart3 className="h-8 w-8 text-white" />
      </div>
      <h2 className="text-3xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent">
        Data Analysis
      </h2>
    </div>
    
    {/* Enhanced Column Analysis */}
    <div className="group relative">
      <div className="absolute inset-0 bg-gradient-to-r from-purple-400 to-indigo-400 rounded-2xl blur opacity-20 group-hover:opacity-30 transition-opacity duration-300"></div>
      <div className="relative bg-white rounded-2xl shadow-xl p-8">
        <h3 className="text-2xl font-bold mb-6 flex items-center">
          <div className="p-2 bg-gradient-to-r from-purple-500 to-indigo-500 rounded-lg mr-3">
            <BarChart3 className="text-white" size={24} />
          </div>
          Column Analysis
        </h3>
        
        <div className="mb-6">
          <label className="block text-sm font-bold text-slate-700 mb-3">
            Select Column for Analysis:
          </label>
          <div className="relative">
            <select
              value={selectedColumn}
              onChange={(e) => setSelectedColumn(e.target.value)}
              className="block w-full px-4 py-3 bg-gradient-to-r from-purple-50 to-indigo-50 border-2 border-purple-200 rounded-xl shadow-sm focus:outline-none focus:ring-4 focus:ring-purple-500/20 focus:border-purple-500 text-slate-800 font-semibold transition-all duration-300"
            >
              <option value="">Choose a column to analyze...</option>
              {headers.map(header => (
                <option key={header} value={header}>{header}</option>
              ))}
            </select>
            <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
              <Search className="h-5 w-5 text-purple-400" />
            </div>
          </div>
        </div>

        {selectedColumn && (
          <div className="mt-8 p-6 bg-gradient-to-r from-purple-50 to-indigo-50 rounded-xl">
            <h4 className="text-xl font-bold mb-6 text-slate-800">Analysis for: <span className="text-purple-600">{selectedColumn}</span></h4>
            
            {/* Generate basic statistics */}
            {(() => {
              const analysisData = getDataForAnalysis();
              const columnData = analysisData.map(row => row[selectedColumn]).filter(val => val);
              const numericData = columnData.map(val => parseFloat(val)).filter(val => !isNaN(val));
              
              if (numericData.length > 0) {
                return (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                    <MetricCard label="Count" value={columnData.length} icon={BarChart3} color="blue" />
                    <MetricCard label="Mean" value={(_.mean(numericData) ?? 0).toFixed(2)} icon={TrendingUp} color="green" />
                    <MetricCard label="Min" value={_.min(numericData) ?? 0} icon={BarChart3} color="yellow" />
                    <MetricCard label="Max" value={_.max(numericData) ?? 0} icon={BarChart3} color="red" />
                  </div>
                );
              }
              
              else {
                // Categorical data analysis
                const valueCounts = _.countBy(columnData);
                const topValues = Object.entries(valueCounts)
                  .sort(([,a], [,b]) => b - a)
                  .slice(0, 5);
                
                return (
                  <div className="bg-white rounded-xl p-6 shadow-lg">
                    <h5 className="text-lg font-bold mb-4 text-slate-800">Top 5 Values:</h5>
                    <div className="space-y-3">
                      {topValues.map(([value, count], index) => (
                        <div key={value} className="relative">
                          <div className="flex justify-between items-center p-4 bg-gradient-to-r from-slate-50 to-gray-50 rounded-xl transform transition-all duration-300 hover:scale-[1.02] shadow-sm">
                            <div className="flex items-center space-x-3">
                              <div className={`w-3 h-3 rounded-full bg-gradient-to-r ${
                                index === 0 ? 'from-yellow-400 to-orange-400' :
                                index === 1 ? 'from-gray-400 to-gray-500' :
                                index === 2 ? 'from-orange-400 to-red-400' :
                                'from-purple-400 to-indigo-400'
                              }`}></div>
                              <span className="font-semibold text-slate-700">{value}</span>
                            </div>
                            <div className="flex items-center space-x-2">
                              <span className="text-2xl font-bold text-slate-800">{count}</span>
                              <span className="text-sm text-slate-500">occurrences</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              }
            })()}
          </div>
        )}
      </div>
    </div>

    {/* Enhanced Row Analysis */}
    <div className="group relative">
      <div className="absolute inset-0 bg-gradient-to-r from-cyan-400 to-blue-400 rounded-2xl blur opacity-20 group-hover:opacity-30 transition-opacity duration-300"></div>
      <div className="relative bg-white rounded-2xl shadow-xl p-8">
        <h3 className="text-2xl font-bold mb-6 flex items-center">
          <div className="p-2 bg-gradient-to-r from-cyan-500 to-blue-500 rounded-lg mr-3">
            <Shuffle className="text-white" size={24} />
          </div>
          Row Analysis
        </h3>
        
        <div className="flex justify-center mb-6">
          <button
         onClick={() => {
          const randomIndex = Math.floor(Math.random() * csvData.length);
          
          // Explicitly type row so we can assign keys dynamically
          const row: Record<string, string | undefined> = {};
          
          headers.forEach((header, index) => {
            row[header] = csvData[randomIndex][index];
          });
          
          setSelectedRow(row);
        }}
        
            className="group bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white font-bold py-3 px-6 rounded-xl transform transition-all duration-300 hover:scale-105 shadow-lg hover:shadow-xl flex items-center space-x-3"
          >
            <Shuffle size={20} className="animate-spin" />
            <span>Analyze Random Row</span>
            <div className="absolute inset-0 bg-white/20 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
          </button>
        </div>

        {selectedRow && (
          <div className="p-6 bg-gradient-to-r from-cyan-50 to-blue-50 rounded-xl">
            <h4 className="text-xl font-bold mb-4 text-slate-800 text-center">Selected Row Analysis</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Object.entries(selectedRow).map(([key, value]) => (
                <div key={key} className="bg-white rounded-lg p-4 shadow-sm transform transition-all duration-300 hover:scale-105">
                  <div className="text-sm font-bold text-slate-600 mb-1">{key}</div>
                  <div className="text-lg font-semibold text-slate-800">{value?.toString() || <span className="text-slate-400 italic">N/A</span>}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>

    {/* Enhanced Data Overview */}
    <div className="group relative">
      <div className="absolute inset-0 bg-gradient-to-r from-green-400 to-emerald-400 rounded-2xl blur opacity-20 group-hover:opacity-30 transition-opacity duration-300"></div>
      <div className="relative bg-white rounded-2xl shadow-xl p-8">
        <h3 className="text-2xl font-bold mb-6 flex items-center">
          <div className="p-2 bg-gradient-to-r from-green-500 to-emerald-500 rounded-lg mr-3">
            <PieChart className="text-white" size={24} />
          </div>
          Data Overview
        </h3>
        
        <div className="text-center py-12">
          <div className="text-6xl mb-4">📊</div>
          <h4 className="text-xl font-semibold text-slate-700 mb-2">Advanced Visualizations</h4>
          <p className="text-slate-500 max-w-md mx-auto">
            Charts and visualizations would appear here using your preferred charting library (Plotly, Chart.js, etc.)
          </p>
          <div className="mt-6 flex justify-center space-x-4">
            <div className="px-4 py-2 bg-gradient-to-r from-blue-100 to-purple-100 rounded-lg">
              <span className="text-sm font-semibold text-slate-700">Missing Values Chart</span>
            </div>
            <div className="px-4 py-2 bg-gradient-to-r from-yellow-100 to-orange-100 rounded-lg">
              <span className="text-sm font-semibold text-slate-700">Outliers Distribution</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
)}

{currentPage === 'report' && (
  <div className="space-y-8 animate-fadeIn">
    <div className="flex items-center space-x-3 mb-6">
      <div className="p-3 bg-gradient-to-r from-orange-500 to-red-500 rounded-xl shadow-lg">
        <FileDown className="h-8 w-8 text-white" />
      </div>
      <h2 className="text-3xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent">
        Generate Report
      </h2>
    </div>
    
    <div className="group relative">
      <div className="absolute inset-0 bg-gradient-to-r from-orange-400 to-red-400 rounded-2xl blur opacity-20 group-hover:opacity-30 transition-opacity duration-300"></div>
      <div className="relative bg-white rounded-2xl shadow-xl p-8">
        <h3 className="text-2xl font-bold mb-6 text-slate-800">Report Summary</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
          <div className="p-6 bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl">
            <h4 className="text-xl font-bold mb-4 text-slate-800">Data Statistics</h4>
            <div className="space-y-3">
              <div className="flex justify-between items-center p-3 bg-white rounded-lg shadow-sm">
                <span className="font-semibold text-slate-600">Cleaned rows:</span>
                <span className="text-2xl font-bold text-green-600">{cleanedData.length > 0 ? cleanedData.length.toLocaleString() : 'Not cleaned yet'}</span>
              </div>
              <div className="flex justify-between items-center p-3 bg-white rounded-lg shadow-sm">
                <span className="font-semibold text-slate-600">Columns:</span>
                <span className="text-2xl font-bold text-purple-600">{headers.length}</span>
              </div>
              <div className="flex justify-between items-center p-3 bg-white rounded-lg shadow-sm">
                <span className="font-semibold text-slate-600">Issues found:</span>
                <span className="text-2xl font-bold text-red-600">{
                  Object.keys(issues?.missing || {}).length + 
                  (issues?.duplicates || 0) + 
                  Object.keys(issues?.whitespace || {}).length + 
                  Object.keys(issues?.leadingZeros || {}).length
                }</span>
              </div>
            </div>
          </div>

          <div className="p-6 bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl">
            <h4 className="text-xl font-bold mb-4 text-slate-800">Cleaning Actions</h4>
            <div className="space-y-3">
              {cleaningLog.length > 0 ? (
                cleaningLog.slice(0, 5).map((log, index) => (
                  <div key={index} className="flex items-center p-3 bg-white rounded-lg shadow-sm transform transition-all duration-300 hover:scale-[1.02]">
                    <div className="w-2 h-2 bg-green-500 rounded-full mr-3 animate-pulse"></div>
                    <span className="text-slate-700 font-medium">{log.message}</span>
                  </div>
                ))
              ) : (
                <div className="text-center py-6">
                  <Settings className="mx-auto h-12 w-12 text-slate-400 mb-2" />
                  <p className="text-slate-500 italic">No cleaning performed yet</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-6 justify-center">
          <button
            onClick={generatePDF}
            className="group bg-gradient-to-r from-red-500 to-pink-500 hover:from-red-600 hover:to-pink-600 text-white font-bold py-4 px-8 rounded-xl transform transition-all duration-300 hover:scale-105 shadow-lg hover:shadow-xl flex items-center space-x-3"
          >
            <FileDown size={24} />
            <span className="text-lg">Generate PDF Report</span>
            <div className="absolute inset-0 bg-white/20 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
          </button>

          {cleanedData.length > 0 && (
            <button
              onClick={downloadCSV}
              className="group bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white font-bold py-4 px-8 rounded-xl transform transition-all duration-300 hover:scale-105 shadow-lg hover:shadow-xl flex items-center space-x-3"
            >
              <Download size={24} />
              <span className="text-lg">Download Cleaned Data</span>
              <div className="absolute inset-0 bg-white/20 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
            </button>
          )}
        </div>
      </div>
    </div>

    {/* Enhanced Report Preview */}
    <div className="group relative">
      <div className="absolute inset-0 bg-gradient-to-r from-slate-400 to-gray-400 rounded-2xl blur opacity-20 group-hover:opacity-30 transition-opacity duration-300"></div>
      <div className="relative bg-white rounded-2xl shadow-xl p-8">
        <h3 className="text-2xl font-bold mb-6 flex items-center">
          <div className="p-2 bg-gradient-to-r from-slate-600 to-gray-600 rounded-lg mr-3">
            <Eye className="text-white" size={24} />
          </div>
          Report Preview
        </h3>
        
        <div className="bg-gradient-to-br from-slate-50 to-gray-50 p-8 rounded-xl border-2 border-dashed border-slate-300">
          <div className="text-center mb-8">
            <h4 className="text-3xl font-bold bg-gradient-to-r from-slate-800 to-gray-600 bg-clip-text text-transparent mb-2">
              AutoClean CSV Report
            </h4>
            <p className="text-sm text-slate-600 bg-white px-4 py-2 rounded-full inline-block shadow-sm">
              Generated on: {new Date().toLocaleDateString()}
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div className="bg-white p-6 rounded-xl shadow-sm transform transition-all duration-300 hover:scale-105">
              <h5 className="text-lg font-bold text-slate-800 mb-3">Dataset Overview</h5>
              <div className="space-y-2 text-sm text-slate-600">
                <div className="flex justify-between">
                  <span>Total rows:</span>
                  <span className="font-bold">{csvData.length.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>Columns:</span>
                  <span className="font-bold">{headers.length}</span>
                </div>
                <div className="flex justify-between">
                  <span>Issues detected:</span>
                  <span className="font-bold text-red-600">{
                    Object.keys(issues?.missing || {}).length + 
                    (issues?.duplicates || 0) + 
                    Object.keys(issues?.whitespace || {}).length
                  }</span>
                </div>
              </div>
            </div>

            <div className="bg-white p-6 rounded-xl shadow-sm transform transition-all duration-300 hover:scale-105">
              <h5 className="text-lg font-bold text-slate-800 mb-3">Issues Detected</h5>
              <div className="space-y-2 text-sm text-slate-600">
                {Object.keys(issues?.missing || {}).length > 0 && (
                  <div className="flex items-center">
                    <div className="w-2 h-2 bg-yellow-500 rounded-full mr-2"></div>
                    <span>Missing values in {Object.keys(issues?.missing || {}).length} columns</span>
                  </div>
                )}
                {(issues?.duplicates || 0) > 0 && (
                  <div className="flex items-center">
                    <div className="w-2 h-2 bg-red-500 rounded-full mr-2"></div>
                    <span>{issues?.duplicates} duplicate rows found</span>
                  </div>
                )}
                {Object.keys(issues?.whitespace || {}).length > 0 && (
                  <div className="flex items-center">
                    <div className="w-2 h-2 bg-purple-500 rounded-full mr-2"></div>
                    <span>Whitespace issues in {Object.keys(issues?.whitespace || {}).length} columns</span>
                  </div>
                )}
                {Object.keys(issues?.leadingZeros || {}).length > 0 && (
                  <div className="flex items-center">
                    <div className="w-2 h-2 bg-cyan-500 rounded-full mr-2"></div>
                    <span>Leading zero issues in {Object.keys(issues?.leadingZeros || {}).length} columns</span>
                  </div>
                )}
              </div>
            </div>

            {cleaningLog.length > 0 && (
              <div className="bg-white p-6 rounded-xl shadow-sm transform transition-all duration-300 hover:scale-105">
                <h5 className="text-lg font-bold text-slate-800 mb-3">Cleaning Summary</h5>
                <div className="space-y-2 text-sm text-slate-600">
                  {cleaningLog.slice(0, 4).map((log, index) => (
                    <div key={index} className="flex items-center">
                      <div className="w-2 h-2 bg-green-500 rounded-full mr-2"></div>
                      <span className="truncate">{log.message}</span>
                    </div>
                  ))}
                  {cleaningLog.length > 4 && (
                    <div className="text-xs text-slate-500 italic">
                      ...and {cleaningLog.length - 4} more actions
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="text-center mt-8">
            <div className="inline-flex items-center px-6 py-3 bg-gradient-to-r from-blue-100 to-purple-100 rounded-full">
              <Sparkles className="mr-2 h-5 w-5 text-purple-600" />
              <span className="text-purple-800 font-semibold">Ready for export and distribution</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
)}
      </div>
    </div>
  );
};

export default AutoCleanCSV;
