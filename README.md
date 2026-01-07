# Steam Purchase Timing Guide

🔗 **Live Service**: https://buyornot.sesl0ver.dev

Steam **게임 / 패키지(Sub) / 번들(Bundle)**의 가격·할인·역대 최저가·리뷰·언어 지원 정보를 종합하여,  
**구매 시점 판단에 필요한 객관적 근거를 제공하는 웹 서비스**입니다.

본 프로젝트는 구매를 직접 유도하거나 점수화를 하지 않으며, 공개된 데이터를 시각적으로 정리하여 사용자의 합리적인 소비를 돕는 데 집중합니다.

---

## 📌 서비스 개요

* **통합 검색 분석**: Steam 스토어 URL, App ID 또는 게임명 검색을 통한 즉각적인 데이터 분석
* **가격 위치 추적**: 현재 가격이 **역대 최저가(ATL)** 대비 어느 지점에 있는지 직관적으로 제공
* **구매 가이드 제공**: 할인 종료 시점, 리뷰 흐름, 한국어 지원, DLC 규모 등을 한 화면에 정리
* **개인화 기능**: Steam OpenID 연동을 통한 위시리스트 관리 및 최근 조회 기록 제공

---

## 🔍 제공 기능

### 1. 종합 분석 (App / Sub / Bundle 공통)
* **현재 가격 및 할인 정보**: 실시간 가격 및 할인율, 할인 종료 시점(남은 시간) 안내
* **역대 최저가 추적**: IsThereAnyDeal 데이터를 활용한 역대 최저가 및 현재 가격과의 차이 비교
* **리뷰 요약**: Steam 사용자 리뷰의 긍·부정 비율 및 정성적 평가 요약

### 2. App 상세 정보
* **한국어 지원 여부**: 공식 한국어(텍스트/음성) 지원 상태 표시
* **커뮤니티 한글패치**: 유저가 제작한 비공식 한글패치 정보 및 관련 링크 제공
* **DLC 규모 분석**: 포함된 DLC의 개수 및 총합 가격 정보를 통해 본편 대비 비용 분석
* **도전과제 정보**: 전체 도전과제 개수 등 게임 규모 참고 데이터 제공
* **번들상품 정보**: 현재 판매 중인 번들에 게임이 포함되어있는지에 대한 정보 제공

### 3. 사용자 편의 기능
* **Steam 로그인**: OpenID를 통한 안전한 로그인 및 프로필 연동
* **위시리스트(찜 목록)**: Steam 위시리스트를 불러오거나 서비스 내에서 직접 관리
* **최근 조회 목록**: 사용자가 최근에 살펴본 게임들을 메인 화면에서 빠르게 다시 확인
* **지능형 검색**: URL이나 ID를 입력하면 검색 과정을 거치지 않고 즉시 상세 정보로 연결

### 4. 관리자 시스템
* **한글 패치 관리**: 커뮤니티 한글 패치 정보 등록, 수정 및 삭제
* **서비스 통계**: DAU(일일 활성 사용자), 실시간 접속자(CCU), 인기 조회 게임 등 통계 대시보드

---

## 🌐 데이터 출처 및 외부 API

본 서비스는 다음의 외부 API 및 공개 데이터를 사용합니다.

* **Steam Store API**: 게임/패키지/번들의 상세 사양, 가격 및 할인 데이터
* **Steam Web API**: 사용자 리뷰 데이터 및 OpenID 인증
* **IsThereAnyDeal (ITAD) API**: 가격 히스토리 및 역대 최저가 추적 데이터, 번들 상품 정보

데이터는 각 API 제공 범위와 정책에 따라 실시간 정보와 일부 차이가 발생할 수 있으며, 서비스 성능을 위해 캐싱된 데이터를 활용합니다.

---

## ⚠️ 고지 사항

* 본 서비스는 **Steam 또는 Valve와 무관한 비공식 서비스**입니다.
* 제공되는 정보는 참고용이며, 최종 구매 판단과 그 결과에 대한 책임은 사용자 본인에게 있습니다.
* 유저 한글패치 정보는 커뮤니티 기반의 비공식 자료로, 안정성이나 보안을 보장하지 않습니다.
* 최종 구매 전에는 반드시 Steam 공식 상점 페이지의 가격과 정보를 다시 확인하시기 바랍니다.

---

## 🛠 기술 스택

### Backend
* **Language**: PHP 8.5+
* **Framework**: Slim Framework 4
* **DI Container**: PHP-DI
* **HTTP Client**: Guzzle HTTP
* **Template Engine**: Twig

### Frontend
* **Styles**: Tailwind CSS
* **Script**: Vanilla JavaScript (ES Modules 기반 컴포넌트 구조)
* **Build**: Tailwind CLI (Lightning CSS 활용 최적화)

### Infrastructure & Storage
* **Database**: PostgreSQL
* **Cache & Stats**: Redis (데이터 캐싱, 통계 기록, 속도 제한)

---

## 📄 License

This project is licensed under the **MIT License**.

* Source code is freely usable, modifiable, and distributable.
* External data (Steam, IsThereAnyDeal) is subject to each provider’s terms of service.

---

© Steam Purchase Timing Guide
