/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Khởi tạo Gemini AI SDK phía máy chủ
const apiKey = process.env.GEMINI_API_KEY || '';
let ai: GoogleGenAI | null = null;

if (apiKey) {
  ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// 1. API: Đề xuất ma trận & bảng đặc tả từ kiến thức và Thông tư 27
app.post('/api/ai/matrix', async (req, res) => {
  try {
    const { grade, subjectName, period, textbook, topics, documentContent } = req.body;

    if (!ai) {
      return res.status(200).json({
        success: false,
        message: 'Chưa cấu hình GEMINI_API_KEY, sử dụng bộ ma trận chuẩn tích hợp.',
        fallback: true,
      });
    }

    const prompt = `
Bạn là chuyên gia thẩm định ma trận đề kiểm tra tiểu học theo Thông tư 27/2020/TT-BGDĐT của Bộ Giáo dục và Đào tạo Việt Nam.
Hãy xây dựng Ma trận đề kiểm tra và Bảng đặc tả chi tiết cho:
- Lớp: ${grade}
- Môn: ${subjectName}
- Thời điểm: ${period}
- Bộ sách: ${textbook}
- Mạch kiến thức / Chủ đề trọng tâm: ${topics || 'Chương trình chuẩn'}
- Nội dung trích xuất tài liệu (nếu có): ${documentContent ? documentContent.slice(0, 1500) : 'Dựa trên chương trình GDPT 2018'}

Yêu cầu bắt buộc:
1. Tổng điểm toàn bài: đúng 10.0 điểm.
2. Tỉ lệ 3 mức độ nhận thức theo Thông tư 27:
   - Mức 1 (Biết / Nhận biết): 40% (4.0 điểm)
   - Mức 2 (Hiểu / Kết nối): 40% (4.0 điểm)
   - Mức 3 (Vận dụng): 20% (2.0 điểm)
3. Kết cấu số câu trắc nghiệm và tự luận cân đối phù hợp với thời gian 40 phút.
Trả về dữ liệu theo định dạng JSON với cấu trúc:
{
  "matrixRows": [
    {
      "id": "mr-1",
      "topic": "Tên chủ đề 1",
      "m1_tn_count": 2, "m1_tn_points": 1.0,
      "m1_tl_count": 1, "m1_tl_points": 0.5,
      "m2_tn_count": 1, "m2_tn_points": 0.5,
      "m2_tl_count": 1, "m2_tl_points": 1.0,
      "m3_tn_count": 0, "m3_tn_points": 0,
      "m3_tl_count": 1, "m3_tl_points": 1.0,
      "total_questions": 6,
      "total_points": 4.0
    }
  ],
  "specificationRows": [
    {
      "id": "spec-1",
      "topic": "Tên chủ đề 1",
      "competencyRequired": "Yêu cầu cần đạt chi tiết...",
      "m1_tn_desc": "Mô tả câu mức 1",
      "m2_tn_desc": "Mô tả câu mức 2",
      "m3_tl_desc": "Mô tả câu mức 3",
      "questionNumbers": "Câu 1, Câu 2..."
    }
  ],
  "totalPoints": 10.0
}
Chỉ trả về JSON thuần, không bọc markdown thừa.
`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    return res.json({ success: true, data: parsed });
  } catch (error: any) {
    console.error('Lỗi API tạo ma trận:', error);
    return res.status(200).json({
      success: false,
      message: error?.message || 'Có lỗi xảy ra, sử dụng thuật toán chuẩn.',
      fallback: true,
    });
  }
});

// 2. API: Sinh đề kiểm tra hoàn chỉnh theo đúng ma trận đã xác nhận
app.post('/api/ai/exam', async (req, res) => {
  try {
    const { examMeta, matrixRows, specificationRows } = req.body;

    if (!ai) {
      return res.status(200).json({
        success: false,
        message: 'Chưa cấu hình GEMINI_API_KEY, kích hoạt bộ sinh đề dự phòng sư phạm chuẩn.',
        fallback: true,
      });
    }

    const prompt = `
Bạn là chuyên gia ra đề kiểm tra tiểu học chuẩn Thông tư 27/2020/TT-BGDĐT.
Hãy biên soạn đề kiểm tra hoàn chỉnh bám sát 100% Ma trận và Bảng đặc tả sau:
- Trường: ${examMeta.schoolName || 'PTDTBT TIỂU HỌC CHÍ CÀ'}
- Lớp: ${examMeta.grade}
- Môn: ${examMeta.subjectName}
- Mã đề: ${examMeta.code || 'Đề chính thức'}
- Thời gian: ${examMeta.durationMinutes || 40} phút
- Ma trận tóm tắt: ${JSON.stringify(matrixRows)}

Quy định hình thức và cấu trúc đề (RẤT QUAN TRỌNG):
1. KHÔNG ghi tiêu đề phân tách "Trắc nghiệm" hay "Tự luận" trên bài làm học sinh.
2. Các câu sắp xếp từ Câu 1 đến hết đề (từ trắc nghiệm khách quan đến tự luận).
3. Câu hỏi trắc nghiệm gồm 4 thể loại chính:
   - Trắc nghiệm nhiều lựa chọn: câu có 2 ý (a, b), mỗi ý có các lựa chọn A, B, C.
   - Trắc nghiệm Đúng - Sai: bảng 2 cột (Cột 1: 4 phát biểu, Cột 2: để trống đánh dấu Đ/S).
   - Trắc nghiệm Nối cột: Bảng 2 cột (Cột A: 4 ý, Cột B: 4 ý xáo trộn).
   - Trắc nghiệm Điền khuyết: Cho sẵn từ lựa chọn và chỗ trống (...).
4. Câu tự luận: Ghi rõ đề bài, gợi ý đáp án mẫu và biểu điểm chi tiết (tổng điểm toàn bài = đúng 10.0 điểm).

Trả về định dạng JSON thuần của mảng các câu hỏi:
{
  "questions": [
    {
      "id": "q-1",
      "questionNumber": 1,
      "type": "multiple_choice",
      "cognitiveLevel": 1,
      "topic": "...",
      "points": 0.5,
      "prompt": "...",
      "subQuestions": [
        {
          "id": "q-1a",
          "subLabel": "a",
          "prompt": "...",
          "options": [
            { "key": "A", "text": "..." },
            { "key": "B", "text": "..." },
            { "key": "C", "text": "..." }
          ],
          "correctAnswer": "A",
          "explanation": "..."
        }
      ]
    }
  ]
}
`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    return res.json({ success: true, data: parsed });
  } catch (error: any) {
    console.error('Lỗi API sinh đề thi:', error);
    return res.status(200).json({
      success: false,
      message: error?.message || 'Có lỗi khi gọi Gemini, sử dụng ngân hàng câu hỏi chuẩn.',
      fallback: true,
    });
  }
});

// 3. API: Đổi / Tạo lại 1 câu hỏi cụ thể theo yêu cầu giáo viên
app.post('/api/ai/regenerate-question', async (req, res) => {
  try {
    const { question, subjectName, grade } = req.body;

    if (!ai) {
      return res.status(200).json({
        success: false,
        message: 'Chưa cấu hình GEMINI_API_KEY.',
        fallback: true,
      });
    }

    const prompt = `
Bạn là giáo viên tiểu học. Hãy tạo ra MỘT câu hỏi thay thế MỚI TƯƠNG ĐƯƠNG cho câu hỏi sau:
- Môn: ${subjectName}, Lớp ${grade}
- Dạng câu: ${question.type}
- Mức độ nhận thức: Mức ${question.cognitiveLevel}
- Số điểm: ${question.points}
- Chủ đề: ${question.topic}
- Câu hỏi cũ: ${question.prompt}

Câu hỏi mới phải cùng mức độ, cùng số điểm, cùng cấu trúc nhưng nội dung đổi mới, chuẩn chương trình tiểu học.
Trả về JSON duy nhất:
{
  "question": {
    "id": "${question.id}",
    "questionNumber": ${question.questionNumber},
    "type": "${question.type}",
    "cognitiveLevel": ${question.cognitiveLevel},
    "topic": "${question.topic}",
    "points": ${question.points},
    "prompt": "...",
    ...
  }
}
`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    return res.json({ success: true, data: parsed });
  } catch (error: any) {
    console.error('Lỗi API tạo lại câu hỏi:', error);
    return res.status(200).json({
      success: false,
      message: error?.message || 'Lỗi xử lý AI',
      fallback: true,
    });
  }
});

// Vite middleware hoặc static assets
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
  });
}

startServer();
