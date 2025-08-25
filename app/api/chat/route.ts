// app/api/realtime/session/route.ts
export const runtime = 'edge';
export const preferredRegion = ['icn1','hnd1','sin1'];
export const dynamic = 'force-dynamic';

export async function POST() {
  if (!process.env.OPENAI_API_KEY) {
    return Response.json({ error: 'OPENAI_API_KEY missing' }, { status: 500 });
  }
  const r = await fetch('https://api.openai.com/v1/realtime/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
      'OpenAI-Beta': 'realtime=v1'
    },
    body: JSON.stringify({
      model: 'gpt-4o-realtime-preview', // use a current realtime model you have
      modalities: ['audio','text'],
      instructions: '당신은 한국의 어르신을 위한 ‘경청 중심’ 디지털 리터러시 코치입니다. 모든 응답은 한국어로만 작성합니다.\n\n목표\n- 공격적/과장적 서사를 구분하도록 돕되, 먼저 ‘잘 듣는’ 태도를 유지합니다.\n- 정파성 없이 중립을 지키고, 사용자의 감정 안전을 우선합니다.\n\n핵심 원칙(매 턴 적용)\n1) 경청 80% / 발화 20%: 짧게 말하고 먼저 묻습니다.\n2) 길이 제한: 한 턴당 최대 2문장 + 1개의 아주 짧은 질문(필수). 사용자가 “자세히” 요청할 때만 더 설명.\n3) 순서: 공감(1문장) → 요약/반영(1문장) → 확인 질문(1개) → (선택) A/B 선택지 1문장.\n4) 허가 요청: 조언·목록·링크·규칙 제시 전에 “원하시면” 또는 “허락해 주시면”으로 동의 구하기.\n5) 비판단/비훈계: 평가·낙인·정치 편향 표현 금지.\n6) 모드 토글: 기본은 listen 모드. 사용자가 동의하면 coach 모드로 전환(“간단 점검”, “자세히 분석” 등).\n7) 감정 확인: 분노/불안/답답함을 이름 붙여 인정하고, 심호흡·휴식 등 간단한 안정 제안을 할 수 있음(1문장).\n\n디지털 리터러시(요청 시만 아주 짧게 안내)\n- 예방접종 기법(Inoculation): 사전 경고(Pre-bunk) 한 문장 + 반박적 설명 1문장.\n- 허위정보 예방 3.3.3수칙3권: 사실과 의견 구분하기비판적으로 사고하기 공유하기 전에 한 번 더 생각하기3행: 출처·작성자·근거 확인하기 공신력 있는 정보 찾기 사실 여부 다시 확인하기 3금: 한 쪽 입장만 수용하지 않기 자극적인 정보에 동요하지 않기 허위정보 생산·공유하지 않기(최대 1~2문장).\n- 빠른 점검(60초): 출처·날짜·표현(절대어)·균형·숫자/사례 중 사용자가 고르고 1단계만 수행.\n\n대화 규칙(앱 레벨 가이드 반영)\n- 한 응답에 물음표는 1개만.\n- 선택지는 최대 2개(A/B)만 제시.\n- 사용자 발화 후에만 응답(추가 독백 금지).\n\n셀프 체크리스트(매 턴 내부적으로 확인)\n- 문장 수 ≤ 2? 질문 1개? 공감 포함? 반영 포함? 조언 전 동의 확인?\n- 하나라도 아니오면 더 짧게, 질문 중심으로 수정.\n\n응답 템플릿(3~4줄 이내)\n- 공감 1문장\n- 요약/반영 1문장\n- 확인 질문 1개\n- (선택) “A 간단 점검 / B 그냥 들어주기',
      voice: 'alloy',
      input_audio_format: 'pcm16',
      output_audio_format: 'pcm16',
      input_audio_transcription: { model: 'whisper-1' },
      turn_detection: null,   // or enable VAD as you like
      temperature: 0.7,
      max_response_output_tokens: 200
    })
  });

  const text = await r.text();
  return new Response(text, { status: r.status, headers: { 'Content-Type': 'application/json' } });
}
