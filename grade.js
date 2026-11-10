// api/grade.js - Vercel Serverless Function to grade essay answers with Gemini AI
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Please use POST.' });
  }

  try {
    const { examId, examTitle, questions, apiKey: clientApiKey } = req.body;

    const apiKey = clientApiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(400).json({
        error: 'Chưa cấu hình GEMINI_API_KEY. Vui lòng cung cấp API key trong cài đặt hoặc thiết lập biến môi trường trên Vercel.'
      });
    }

    if (!questions || !Array.isArray(questions)) {
      return res.status(400).json({ error: 'Dữ liệu câu hỏi không hợp lệ.' });
    }

    // Build the grading prompt with full rubric
    let promptContent = `BẠN LÀ GIÁM KHẢO CHẤM THI CÔNG CHỨC NHÀ NƯỚC MÔN NGHIỆP VỤ CHUYÊN NGÀNH MÔI TRƯỜNG & ĐẤT ĐAI TẠI THÀNH PHỐ HUẾ.
Nhiệm vụ của bạn: Chấm điểm bài thi viết tự luận sau đây theo ĐÚNG BAREM ĐIỂM CHI TIẾT (thang điểm 100, gồm 4 câu, mỗi câu tối đa 25.0 điểm).
Nguyên tắc chấm:
1. Đánh giá khách quan, chuẩn xác theo từng tiêu chí trong Barem (chia nhỏ đến 0.25 - 0.5 điểm).
2. Kiểm tra việc viện dẫn văn bản quy phạm pháp luật (Luật Đất đai 2024, Luật BVMT 2020, NĐ 102/2024, NĐ 88/2024, NĐ 151/2025, NĐ 05/2025...). Nếu viện dẫn đúng số điều, khoản, tên nghị định thì cho điểm tối đa của ý đó. Nếu chỉ nói chung chung thì trừ điểm.
3. Không châm chước, không tự suy diễn nếu thí sinh không viết ra.
4. Trả về KẾT QUẢ DUY NHẤT LÀ ĐỊNH DẠNG JSON (không bọc trong markdown code fence, hoặc bọc trong \`\`\`json).

THÔNG TIN ĐỀ THI: ${examTitle || ('Đề số ' + examId)}

DƯỚI ĐÂY LÀ ĐỀ BÀI, BAREM VÀ BÀI LÀM CỦA THÍ SINH CHO TỪNG CÂU:
`;

    questions.forEach((q, idx) => {
      promptContent += `\n========================================\nCÂU ${q.num || (idx + 1)} (Tối đa: ${q.score || 25} điểm)\nĐề bài: ${q.content}\n\nBAREM ĐIỂM VÀ ĐÁP ÁN THAM KHẢO:\n`;
      if (q.rubric && Array.isArray(q.rubric)) {
        q.rubric.forEach((r, rIdx) => {
          promptContent += `- Tiêu chí ${rIdx + 1} (${r.points} điểm): ${r.criteria} [Căn cứ: ${r.reference || ''}]\n`;
        });
      }
      promptContent += `\nBÀI LÀM CỦA THÍ SINH CHO CÂU ${q.num || (idx + 1)}:\n"""\n${q.userAnswer && q.userAnswer.trim() ? q.userAnswer : '(Thí sinh để trống không làm câu này)'}\n"""\n`;
    });

    promptContent += `\nHÃY TRẢ VỀ JSON CÓ CẤU TRÚC NHƯ SAU:
{
  "totalScore": 75.5,
  "passed": true,
  "generalFeedback": "Nhận xét tổng quát về phong cách hành chính, kiến thức pháp lý và kỹ năng xử lý tình huống của thí sinh.",
  "results": [
    {
      "questionNum": 1,
      "score": 20.5,
      "maxScore": 25,
      "strengths": ["Nêu được đầy đủ 4 nhóm dự án theo NĐ 05/2025", "Xác định đúng thẩm quyền của UBND cấp huyện"],
      "missingPoints": ["Chưa nêu rõ tiêu chí diện tích đất mặt nước nhạy cảm theo Điều 28 Luật BVMT"],
      "comment": "Bài viết lập luận tốt, nắm chắc các quy định mới của Nghị định 05/2025/NĐ-CP."
    }
  ]
}`;

    // Call Google Gemini API
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptContent }] }],
        generationConfig: {
          temperature: 0.2,
          topP: 0.8,
          maxOutputTokens: 3500,
          responseMimeType: "application/json"
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({
        error: `Lỗi kết nối Gemini API (${response.status}): ${errText}`
      });
    }

    const data = await response.json();
    const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!candidateText) {
      return res.status(500).json({ error: 'Không nhận được phản hồi từ mô hình AI.' });
    }

    // Parse JSON
    let parsedResult;
    try {
      const cleanJson = candidateText.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
      parsedResult = JSON.parse(cleanJson);
    } catch (e) {
      return res.status(200).json({
        rawResponse: candidateText,
        warning: 'Không thể phân tích JSON tự động, trả về văn bản gốc.'
      });
    }

    return res.status(200).json(parsedResult);
  } catch (error) {
    console.error('Grading error:', error);
    return res.status(500).json({ error: 'Lỗi máy chủ nội bộ: ' + error.message });
  }
}
