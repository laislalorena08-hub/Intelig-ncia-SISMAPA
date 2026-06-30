import os
import sys
import re
import json
from datetime import datetime
import pypdf

# Configurações de caminhos
WORKSPACE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(WORKSPACE_DIR, "data")
DATABASE_JSON = os.path.join(DATA_DIR, "database.json")
DATABASE_JS = os.path.join(DATA_DIR, "database.js")

def ensure_directories():
    if not os.path.exists(DATA_DIR):
        os.makedirs(DATA_DIR)

def load_database():
    ensure_directories()
    if os.path.exists(DATABASE_JSON):
        try:
            with open(DATABASE_JSON, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"Erro ao carregar banco de dados JSON: {e}. Inicializando novo.")
    return {"reports": []}

def save_database(db):
    ensure_directories()
    # Salvar em JSON
    with open(DATABASE_JSON, "w", encoding="utf-8") as f:
        json.dump(db, f, indent=2, ensure_ascii=False)
    
    # Salvar em JS (para evitar problemas de CORS no index.html local)
    with open(DATABASE_JS, "w", encoding="utf-8") as f:
        f.write(f"window.dashboardData = {json.dumps(db, indent=2, ensure_ascii=False)};")

def parse_date(date_str):
    if not date_str or date_str.strip() == "":
        return None
    try:
        return datetime.strptime(date_str.strip(), "%d/%m/%Y")
    except ValueError:
        return None

def extract_pdf_data(pdf_path):
    print(f"Lendo PDF: {pdf_path}...")
    reader = pypdf.PdfReader(pdf_path)
    
    full_text = ""
    for i, page in enumerate(reader.pages):
        text = page.extract_text()
        if text:
            full_text += text + "\n"

    lines = [line.strip() for line in full_text.split("\n") if line.strip()]
    
    # Metadados do relatório
    generation_date_str = None
    total_igr_informed = None
    total_mun_informed = None
    
    # Buscar data de geração e totais
    for line in lines:
        m = re.search(r"Relatório gerado em\s+(\d{2}/\d{2}/\d{4}\s+\d{2}:\d{2}:\d{2})", line)
        if m:
            generation_date_str = m.group(1)
        
        m_tot = re.search(r"Total de:\s*(\d+)\s*Regiões\s*e\s*(\d+)\s*Municípios", line, re.IGNORECASE)
        if m_tot:
            total_igr_informed = int(m_tot.group(1))
            total_mun_informed = int(m_tot.group(2))

    if not generation_date_str:
        for line in lines:
            m = re.search(r"(\d{2}/\d{2}/\d{4}\s+\d{2}:\d{2}(:\d{2})?)", line)
            if m:
                generation_date_str = m.group(1)
                break
        if not generation_date_str:
            generation_date_str = datetime.now().strftime("%d/%m/%Y %H:%M:%S")

    igrs = []
    i = 0
    while i < len(lines):
        line = lines[i]
        
        # Detectar cabeçalho de região
        if "Nome da Região" in line and "Vigência" in line:
            r_name = ""
            r_val = ""
            is_new_r = False
            advance = 2
            
            # Verificar se a próxima linha ou a seguinte após ela indica "Municípios da região"
            if i + 2 < len(lines) and "Municípios da região" in lines[i+2]:
                r_line = lines[i+1]
                if r_line.startswith("NOVO "):
                    is_new_r = True
                    r_line = r_line.replace("NOVO ", "", 1).strip()
                
                date_match = re.search(r"(\d{2}/\d{2}/\d{4})$", r_line)
                if date_match:
                    r_val = date_match.group(1)
                    r_name = r_line[:date_match.start()].strip()
                else:
                    r_name = r_line.strip()
                    r_val = ""
                advance = 2
            elif i + 3 < len(lines) and "Municípios da região" in lines[i+3]:
                r_line = lines[i+1] + " " + lines[i+2]
                if r_line.startswith("NOVO "):
                    is_new_r = True
                    r_line = r_line.replace("NOVO ", "", 1).strip()
                
                date_match = re.search(r"(\d{2}/\d{2}/\d{4})$", r_line)
                if date_match:
                    r_val = date_match.group(1)
                    r_name = r_line[:date_match.start()].strip()
                else:
                    r_name = r_line.strip()
                    r_val = ""
                advance = 3
            else:
                r_line = lines[i+1]
                if r_line.startswith("NOVO "):
                    is_new_r = True
                    r_line = r_line.replace("NOVO ", "", 1).strip()
                
                date_match = re.search(r"(\d{2}/\d{2}/\d{4})$", r_line)
                if date_match:
                    r_val = date_match.group(1)
                    r_name = r_line[:date_match.start()].strip()
                else:
                    r_name = r_line.strip()
                    r_val = ""
                advance = 2
                
            current_igr = {
                "name": r_name,
                "validity": r_val,
                "is_new": is_new_r,
                "municipalities": []
            }
            
            # Avançar para processar municípios
            i += advance
            if i < len(lines) and "Municípios da região" in lines[i]:
                i += 1
                if i < len(lines) and "Nome do Município" in lines[i]:
                    i += 1
                    while i < len(lines):
                        m_line = lines[i]
                        
                        # Pular marcadores de página ou cabeçalhos
                        if "Relatório gerado em" in m_line or re.match(r"^Página \d+ de \d+$", m_line) or m_line.startswith("--- Page "):
                            i += 1
                            continue
                        if any(x in m_line for x in ["RELATÓRIO COMPOSIÇÃO DAS REGIÕES", "MTur - Ministério do Turismo", "UF: Rio Grande do Norte", "Total de:"]):
                            i += 1
                            continue
                            
                        # Verificar se entramos no cabeçalho da próxima região
                        if "Nome da Região" in m_line and "Vigência" in m_line:
                            i -= 1  # Voltar uma linha para que o loop externo trate como nova região
                            break
                        
                        # Também parar se a próxima linha for "Nome da Região..."
                        if i + 1 < len(lines) and "Nome da Região" in lines[i+1] and "Vigência" in lines[i+1]:
                            break
                            
                        # Validar se a linha do município termina com data DD/MM/YYYY
                        date_match = re.search(r"(\d{2}/\d{2}/\d{4})$", m_line)
                        if date_match:
                            is_new_mun = False
                            m_name = m_line[:date_match.start()].strip()
                            if m_name.startswith("NOVO "):
                                is_new_mun = True
                                m_name = m_name.replace("NOVO ", "", 1).strip()
                            
                            m_val = date_match.group(1)
                            current_igr["municipalities"].append({
                                "name": m_name,
                                "validity": m_val,
                                "is_new": is_new_mun
                            })
                        i += 1
            igrs.append(current_igr)
        i += 1

    return {
        "generation_date": generation_date_str,
        "read_date": datetime.now().strftime("%d/%m/%Y %H:%M:%S"),
        "total_igr_informed": total_igr_informed,
        "total_municipalities_informed": total_mun_informed,
        "file_name": os.path.basename(pdf_path),
        "data": {
            "IGRs": igrs
        }
    }

def calculate_municipality_status(validity_str, ref_date_str):
    ref_date = datetime.strptime(ref_date_str.split()[0], "%d/%m/%Y")
    val_date = parse_date(validity_str)
    
    if not val_date:
        return "Sem Vigência", -9999
        
    delta_days = (val_date - ref_date).days
    
    if delta_days < 0:
        return "Vencido", delta_days
    elif delta_days <= 90:
        return "Próximo do Vencimento", delta_days
    else:
        return "Vigente", delta_days

def compare_reports(current_report, previous_report):
    if not previous_report:
        alerts = []
        for igr in current_report["data"]["IGRs"]:
            alerts.append({
                "type": "REGIAO_CRIADA",
                "message": f"Nova região turística registrada: {igr['name']}",
                "target": igr["name"]
            })
            for mun in igr["municipalities"]:
                alerts.append({
                    "type": "NOVO_MUNICIPIO",
                    "message": f"Novo município adicionado à região {igr['name']}: {mun['name']}",
                    "target": mun["name"],
                    "igr": igr["name"]
                })
        return {
            "new_municipalities": [m["name"] for igr in current_report["data"]["IGRs"] for m in igr["municipalities"]],
            "removed_municipalities": [],
            "changed_validity": [],
            "changed_igr": [],
            "new_regions": [igr["name"] for igr in current_report["data"]["IGRs"]],
            "removed_regions": [],
            "alerts": alerts
        }

    # Mapear dados anteriores
    prev_muns = {}
    prev_igrs = {}
    for igr in previous_report["data"]["IGRs"]:
        prev_igrs[igr["name"]] = igr
        for mun in igr["municipalities"]:
            prev_muns[mun["name"]] = {
                "igr": igr["name"],
                "validity": mun["validity"]
            }

    # Mapear dados atuais
    curr_muns = {}
    curr_igrs = {}
    for igr in current_report["data"]["IGRs"]:
        curr_igrs[igr["name"]] = igr
        for mun in igr["municipalities"]:
            curr_muns[mun["name"]] = {
                "igr": igr["name"],
                "validity": mun["validity"]
            }

    new_municipalities = []
    removed_municipalities = []
    changed_validity = []
    changed_igr = []
    new_regions = []
    removed_regions = []
    alerts = []

    # Detectar novas regiões, novos municípios e alterações
    for igr_name, igr in curr_igrs.items():
        if igr_name not in prev_igrs:
            new_regions.append(igr_name)
            alerts.append({
                "type": "REGIAO_CRIADA",
                "message": f"Nova região turística registrada: {igr_name}",
                "target": igr_name
            })
        
        for mun in igr["municipalities"]:
            mun_name = mun["name"]
            if mun_name not in prev_muns:
                new_municipalities.append(mun_name)
                alerts.append({
                    "type": "NOVO_MUNICIPIO",
                    "message": f"Novo município adicionado à região {igr_name}: {mun_name}",
                    "target": mun_name,
                    "igr": igr_name
                })
            else:
                prev_info = prev_muns[mun_name]
                if prev_info["igr"] != igr_name:
                    changed_igr.append({
                        "name": mun_name,
                        "old_igr": prev_info["igr"],
                        "new_igr": igr_name
                    })
                    alerts.append({
                        "type": "MUDANCA_REGIAO",
                        "message": f"Município {mun_name} mudou da região {prev_info['igr']} para {igr_name}",
                        "target": mun_name,
                        "old_igr": prev_info["igr"],
                        "new_igr": igr_name
                    })
                
                if prev_info["validity"] != mun["validity"]:
                    changed_validity.append({
                        "name": mun_name,
                        "old_val": prev_info["validity"],
                        "new_val": mun["validity"]
                    })
                    alerts.append({
                        "type": "ALTERACAO_VIGENCIA",
                        "message": f"Vigência do município {mun_name} alterada de {prev_info['validity'] or 'Sem Vigência'} para {mun['validity'] or 'Sem Vigência'}",
                        "target": mun_name
                    })

    # Detectar remoções de regiões e municípios
    for igr_name, igr in prev_igrs.items():
        if igr_name not in curr_igrs:
            removed_regions.append(igr_name)
            alerts.append({
                "type": "REGIAO_REMOVIDA",
                "message": f"Região turística removida: {igr_name}",
                "target": igr_name
            })

    for mun_name, mun_info in prev_muns.items():
        if mun_name not in curr_muns:
            removed_municipalities.append(mun_name)
            alerts.append({
                "type": "MUNICIPIO_REMOVIDO",
                "message": f"Município removido da regionalização: {mun_name} (estava na região {mun_info['igr']})",
                "target": mun_name,
                "igr": mun_info["igr"]
            })

    # Adicionar alertas baseados no status de validade atual
    for igr in current_report["data"]["IGRs"]:
        for mun in igr["municipalities"]:
            status, days = calculate_municipality_status(mun["validity"], current_report["generation_date"])
            if status == "Vencido":
                alerts.append({
                    "type": "MUNICIPIO_VENCIDO",
                    "message": f"ATENÇÃO: Município VENCIDO na região {igr['name']}: {mun['name']} (venceu em {mun['validity']})",
                    "target": mun["name"],
                    "igr": igr["name"],
                    "days": days
                })
            elif status == "Próximo do Vencimento":
                alerts.append({
                    "type": "MUNICIPIO_VENCENDO_BREVE",
                    "message": f"Alerta: Município {mun['name']} ({igr['name']}) vence em {mun['validity']} ({days} dias restantes)",
                    "target": mun["name"],
                    "igr": igr["name"],
                    "days": days
                })

    # Verificar se alguma região teve redução líquida no total de municípios
    for igr_name, curr_igr in curr_igrs.items():
        if igr_name in prev_igrs:
            prev_count = len(prev_igrs[igr_name]["municipalities"])
            curr_count = len(curr_igr["municipalities"])
            if curr_count < prev_count:
                alerts.append({
                    "type": "REGIAO_REDUCAO_MUNICIPIOS",
                    "message": f"Região {igr_name} teve redução no número de municípios validos: de {prev_count} para {curr_count}",
                    "target": igr_name,
                    "reduction": prev_count - curr_count
                })

    return {
        "new_municipalities": new_municipalities,
        "removed_municipalities": removed_municipalities,
        "changed_validity": changed_validity,
        "changed_igr": changed_igr,
        "new_regions": new_regions,
        "removed_regions": removed_regions,
        "alerts": alerts
    }

def validate_report(report):
    inconsistencies = []
    
    # 1. Verificar contagem informada vs calculada
    calc_igrs = len(report["data"]["IGRs"])
    calc_muns = sum(len(igr["municipalities"]) for igr in report["data"]["IGRs"])
    
    if report["total_igr_informed"] is not None and calc_igrs != report["total_igr_informed"]:
        inconsistencies.append(
            f"Divergência de IGRs: Relatório informa {report['total_igr_informed']} regiões, mas foram extraídas {calc_igrs}."
        )
    if report["total_municipalities_informed"] is not None and calc_muns != report["total_municipalities_informed"]:
        inconsistencies.append(
            f"Divergência de Municípios: Relatório informa {report['total_municipalities_informed']} municípios, mas foram extraídos {calc_muns}."
        )
        
    # 2. Verificar duplicados
    seen_muns = {}
    for igr in report["data"]["IGRs"]:
        for mun in igr["municipalities"]:
            name = mun["name"]
            if name in seen_muns:
                seen_muns[name].append(igr["name"])
            else:
                seen_muns[name] = [igr["name"]]
                
    for mun_name, igr_list in seen_muns.items():
        if len(igr_list) > 1:
            inconsistencies.append(
                f"Município duplicado detectado: '{mun_name}' aparece em múltiplas IGRs: {', '.join(igr_list)}."
            )
            
    # 3. Verificar municípios sem data de vigência
    for igr in report["data"]["IGRs"]:
        if not igr["validity"]:
            inconsistencies.append(
                f"Região '{igr['name']}' não possui data de vigência válida no relatório."
            )
        for mun in igr["municipalities"]:
            if not mun["validity"]:
                inconsistencies.append(
                    f"Município '{mun['name']}' na região '{igr['name']}' está sem data de vigência."
                )
            else:
                parsed_val = parse_date(mun["validity"])
                if not parsed_val:
                    inconsistencies.append(
                        f"Município '{mun['name']}' possui formato de data de vigência inválido: '{mun['validity']}'."
                    )

    # 4. Verificar IGRs sem municípios
    for igr in report["data"]["IGRs"]:
        if len(igr["municipalities"]) == 0:
            inconsistencies.append(
                f"Região '{igr['name']}' foi registrada sem nenhum município associado."
            )
            
    return inconsistencies

def main():
    if len(sys.argv) < 2:
        # Procurar PDF na pasta atual
        pdfs = [f for f in os.listdir(WORKSPACE_DIR) if f.lower().endswith(".pdf")]
        if not pdfs:
            print("Erro: Nenhum arquivo PDF encontrado na pasta atual e nenhum caminho foi passado como argumento.")
            print("Uso: python update_dashboard.py <caminho_do_pdf>")
            sys.exit(1)
        pdfs.sort()
        pdf_path = os.path.join(WORKSPACE_DIR, pdfs[-1])
        print(f"Nenhum arquivo especificado. Usando o PDF mais recente encontrado na pasta: {os.path.basename(pdf_path)}")
    else:
        pdf_path = sys.argv[1]
        if not os.path.isabs(pdf_path):
            pdf_path = os.path.abspath(pdf_path)

    if not os.path.exists(pdf_path):
        print(f"Erro: O arquivo {pdf_path} não existe.")
        sys.exit(1)

    # Carregar banco de dados atual
    db = load_database()
    
    # Extrair novos dados do PDF
    current_report = extract_pdf_data(pdf_path)
    
    # Verificar se esse relatório (pela data de geração) já existe na base
    duplicate_report = next((r for r in db["reports"] if r["generation_date"] == current_report["generation_date"]), None)
    if duplicate_report:
        print(f"\nAviso: Relatório com data de geração '{current_report['generation_date']}' já existe na base histórica.")
        print("Para evitar duplicidade, o processamento foi encerrado sem alterações.")
        sys.exit(0)
        
    # Validar dados extraídos
    inconsistencies = validate_report(current_report)
    if inconsistencies:
        print("\n=== RELATÓRIO DE INCONSISTÊNCIAS E VALIDAÇÃO ===")
        for inc in inconsistencies:
            print(f"- [INCONSISTÊNCIA] {inc}")
        print("================================================\n")
    else:
        print("\nValidação de integridade concluída: Nenhuma inconsistência estrutural encontrada.")

    # Obter relatório anterior para comparação
    previous_report = db["reports"][-1] if db["reports"] else None
    
    # Executar comparação histórica
    diff = compare_reports(current_report, previous_report)
    
    # Anexar as análises ao relatório atual
    current_report["summary"] = {
        "new_municipalities": diff["new_municipalities"],
        "removed_municipalities": diff["removed_municipalities"],
        "changed_validity": diff["changed_validity"],
        "changed_igr": diff["changed_igr"],
        "new_regions": diff["new_regions"],
        "removed_regions": diff["removed_regions"]
    }
    current_report["alerts"] = diff["alerts"]
    current_report["validation_errors"] = inconsistencies

    # Adicionar o relatório atual ao histórico da base
    db["reports"].append(current_report)
    
    # Salvar base atualizada
    save_database(db)
    
    print("\n=== RESUMO EXECUTIVO DE ATUALIZAÇÃO SEMANAL ===")
    print(f"Semana do Relatório: {current_report['generation_date']}")
    calc_muns = sum(len(igr['municipalities']) for igr in current_report['data']['IGRs'])
    calc_igrs = len(current_report['data']['IGRs'])
    print(f"Total de Municípios: {calc_muns} (Informado no PDF: {current_report['total_municipalities_informed']})")
    print(f"Total de IGRs: {calc_igrs} (Informado no PDF: {current_report['total_igr_informed']})")
    print(f"Novos Municípios nesta semana ({len(diff['new_municipalities'])}): {', '.join(diff['new_municipalities']) if diff['new_municipalities'] else 'Nenhum'}")
    print(f"Municípios Removidos nesta semana ({len(diff['removed_municipalities'])}): {', '.join(diff['removed_municipalities']) if diff['removed_municipalities'] else 'Nenhum'}")
    print(f"Novas Regiões nesta semana ({len(diff['new_regions'])}): {', '.join(diff['new_regions']) if diff['new_regions'] else 'Nenhuma'}")
    print(f"Regiões Removidas nesta semana ({len(diff['removed_regions'])}): {', '.join(diff['removed_regions']) if diff['removed_regions'] else 'Nenhuma'}")
    print(f"Alertas de Vencimento/Acompanhamento gerados: {len(diff['alerts'])}")
    print("=======================================")
    print("\nBanco de dados atualizado com sucesso!")
    print(f"Arquivos salvos em:\n- {DATABASE_JSON}\n- {DATABASE_JS}")

if __name__ == "__main__":
    main()
